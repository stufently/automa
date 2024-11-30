import { defineStore } from 'pinia';
import { nanoid } from 'nanoid';
import defu from 'defu';
import deepmerge from 'lodash.merge';
import browser from 'webextension-polyfill';
import dayjs from 'dayjs';
import { fetchApi } from '@/utils/api';
import { tasks } from '@/utils/shared';
import firstWorkflows from '@/utils/firstWorkflows';
import {
  cleanWorkflowTriggers,
  registerWorkflowTrigger,
} from '@/utils/workflowTrigger';
import { useUserStore } from './user';

const defaultWorkflow = (data = null, options = {}) => {
  let workflowData = {
    id: nanoid(),
    name: '',
    icon: 'riGlobalLine',
    folderId: null,
    content: null,
    connectedTable: null,
    drawflow: {
      edges: [],
      zoom: 1.3,
      nodes: [
        {
          position: {
            x: 100,
            y: window.innerHeight / 2,
          },
          id: nanoid(),
          label: 'trigger',
          data: tasks.trigger.data,
          type: tasks.trigger.component,
        },
      ],
    },
    table: [],
    dataColumns: [],
    description: '',
    trigger: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isDisabled: false,
    settings: {
      publicId: '',
      blockDelay: 0,
      saveLog: true,
      debugMode: false,
      restartTimes: 3,
      notification: true,
      execContext: 'popup',
      reuseLastState: false,
      inputAutocomplete: true,
      onError: 'stop-workflow',
      executedBlockOnWeb: false,
      insertDefaultColumn: false,
      defaultColumnName: 'column',
    },
    version: browser.runtime.getManifest().version,
    globalData: '{\n\t"key": "value"\n}',
  };

  if (data) {
    if (options.duplicateId && data.id) {
      delete workflowData.id;
    }

    if (data.drawflow?.nodes?.length > 0) {
      workflowData.drawflow.nodes = [];
    }

    workflowData = defu(data, workflowData);
  }

  return workflowData;
};

// Функция для сравнения рабочих процессов (workflow) без хеширования
function isWorkflowEqual(workflow1, workflow2) {
  // Прямое сравнение через JSON строку
  return JSON.stringify(workflow1.drawflow.nodes) === JSON.stringify(workflow2.drawflow.nodes);
}

function convertWorkflowsToObject(workflows) {
  if (Array.isArray(workflows)) {
    return workflows.reduce((acc, workflow) => {
      acc[workflow.id] = workflow;
      return acc;
    }, {});
  }
  return workflows;
}

export const useWorkflowStore = defineStore('workflow', {
  storageMap: {
    workflows: 'workflows',
  },
  state: () => ({
    states: [],
    workflows: {},
    popupStates: [],
    retrieved: false,
    isFirstTime: false,
  }),
  getters: {
    getAllStates: (state) => [...state.popupStates, ...state.states],
    getById: (state) => (id) => state.workflows[id],
    getWorkflows: (state) => Object.values(state.workflows),
    getWorkflowStates: (state) => (id) =>
      [...state.states, ...state.popupStates].filter(
        ({ workflowId }) => workflowId === id
      ),
  },
  actions: {
    async loadData() {
      const { workflows, isFirstTime } = await browser.storage.local.get([
        'workflows',
        'isFirstTime',
      ]);

      let localWorkflows = workflows || {};

      if (isFirstTime) {
        localWorkflows = firstWorkflows.map((workflow) =>
          defaultWorkflow(workflow)
        );
        await browser.storage.local.set({
          isFirstTime: false,
          workflows: localWorkflows,
        });
      }

      this.isFirstTime = isFirstTime;
      this.workflows = convertWorkflowsToObject(localWorkflows);

      await this.synchronizeWorkflows(); 

      setInterval(() => {
        this.synchronizeWorkflows();
      }, 10 * 60 * 1000); // Синхронизация каждые 10 минут

      await this.saveToStorage('workflows');
      this.retrieved = true;
    },

    async synchronizeWorkflows() {
      try {
        console.log("Начинаем синхронизацию рабочих процессов...");
    
        const response = await fetch('https://automa.cheapvps.ru/api');
        const workflowList = await response.json();
    
        console.log(`Получено ${workflowList.length} рабочих процессов с API.`);
    
        for (const workflowData of workflowList) {
          // Получаем хеш контента рабочего процесса
          const { contentHash } = workflowData;
          const existingWorkflow = this.workflows[workflowData.id];
    
          console.log(`Проверка рабочего процесса с ID: ${workflowData.id}`);
    
          if (existingWorkflow) {
            console.log(`Найден существующий рабочий процесс. Хеш контента: ${existingWorkflow.contentHash}, Новый хеш: ${contentHash}`);
    
            // Если хеш не изменился, пропускаем обновление
            if (existingWorkflow.contentHash === contentHash) {
              console.log(`Workflow ${workflowData.id} не изменился, пропускаем обновление.`);
              continue;
            } else {
              console.log(`Хеши различаются, скачиваем новый файл для Workflow ${workflowData.id}.`);
            }
          } else {
            console.log(`Workflow ${workflowData.id} не найден, добавляем новый.`);
          }
    
          // Если хеш изменился или рабочего процесса нет, скачиваем новый файл
          const jsonResponse = await fetch(workflowData.name);
          const jsonContent = await jsonResponse.json();
    
          // Обновляем или добавляем рабочий процесс
          const newWorkflow = {
            id: workflowData.id,
            ...jsonContent,
            contentHash,  // Сохраняем новый хеш
          };
    
          this.workflows[newWorkflow.id] = newWorkflow;
          console.log(`Workflow ${newWorkflow.id} обновлён или добавлен.`);
        }
    
        console.log("Синхронизация завершена.");
      } catch (error) {
        console.error("Ошибка при загрузке новых рабочих процессов:", error);
      }
    },
    

    async saveToStorage(key) {
      await browser.storage.local.set({
        workflows: this.workflows,
      });
    },

    async update({ id, data = {}, deep = false }) {
      const isFunction = typeof id === 'function';
      if (!isFunction && !this.workflows[id]) return null;

      const updatedWorkflows = {};
      const updateData = { ...data, updatedAt: Date.now() };

      const workflowUpdater = (workflowId) => {
        if (deep) {
          this.workflows[workflowId] = deepmerge(
            this.workflows[workflowId],
            updateData
          );
        } else {
          Object.assign(this.workflows[workflowId], updateData);
        }

        this.workflows[workflowId].updatedAt = Date.now();
        updatedWorkflows[workflowId] = this.workflows[workflowId];

        if (!('isDisabled' in data)) return;

        if (data.isDisabled) {
          cleanWorkflowTriggers(workflowId);
        } else {
          const triggerBlock = this.workflows[workflowId].drawflow.nodes?.find(
            (node) => node.label === 'trigger'
          );
          if (triggerBlock) {
            registerWorkflowTrigger(id, triggerBlock);
          }
        }
      };

      if (isFunction) {
        this.getWorkflows.forEach((workflow) => {
          const isMatch = id(workflow) ?? false;
          if (isMatch) workflowUpdater(workflow.id);
        });
      } else {
        workflowUpdater(id);
      }

      await this.saveToStorage('workflows');

      return updatedWorkflows;
    },

    async insertOrUpdate(
      data = [],
      { checkUpdateDate = false, duplicateId = false } = {}
    ) {
      const insertedData = {};
    
      data.forEach((item) => {
        const currentWorkflow = this.workflows[item.id];
    
        if (currentWorkflow) {
          let insert = true;
          if (checkUpdateDate && currentWorkflow.createdAt && item.updatedAt) {
            insert = dayjs(currentWorkflow.updatedAt).isBefore(item.updatedAt);
          }
    
          // Прямое сравнение данных
          if (insert && !isWorkflowEqual(currentWorkflow, item)) {
            const mergedData = deepmerge(this.workflows[item.id], item);
            this.workflows[item.id] = mergedData;
            insertedData[item.id] = mergedData;
            console.log(`Workflow ${item.id} обновлён (по содержимому).`);
          } else {
            console.log(`Workflow ${item.id} не обновлён (содержимое одинаково).`);
          }
        } else {
          const workflow = defaultWorkflow(item, { duplicateId });
          this.workflows[workflow.id] = workflow;
          insertedData[workflow.id] = workflow;
          console.log(`Workflow ${workflow.id} добавлен.`);
        }
      });
    
      await this.saveToStorage('workflows');
    
      return insertedData;
    },

    async delete(id) {
      if (Array.isArray(id)) {
        id.forEach((workflowId) => {
          delete this.workflows[workflowId];
        });
      } else {
        delete this.workflows[id];
      }

      await cleanWorkflowTriggers(id);

      const userStore = useUserStore();

      const hostedWorkflow = userStore.hostedWorkflows[id];
      const backupIndex = userStore.backupIds.indexOf(id);

      if (hostedWorkflow || backupIndex !== -1) {
        const response = await fetchApi(`/me/workflows?id=${id}`, {
          auth: true,
          method: 'DELETE',
        });
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.message);
        }

        if (backupIndex !== -1) {
          userStore.backupIds.splice(backupIndex, 1);
          await browser.storage.local.set({ backupIds: userStore.backupIds });
        }
      }

      await this.saveToStorage('workflows');
    },
  },
});
