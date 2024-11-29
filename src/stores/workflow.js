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
    contentHash: '', // Поле для хранения хеша
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

  workflowData.contentHash = computeWorkflowHash(workflowData);

  return workflowData;
};

function computeWorkflowHash(workflow) {
  const workflowContent = JSON.stringify(workflow.drawflow.nodes);
  return crypto.createHash('sha256').update(workflowContent).digest('hex');
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
      }, 10 * 60 * 1000); 

      await this.saveToStorage('workflows');
      this.retrieved = true;
    },

    async synchronizeWorkflows() {
      try {
        const response = await fetch('https://automa.cheapvps.ru/api');
        const workflowList = await response.json();
    
        for (const workflowData of workflowList) {
          const jsonResponse = await fetch(workflowData.name);
          const jsonContent = await jsonResponse.json();
          const newWorkflow = {
            id: workflowData.id,
            ...jsonContent,
          };
    
          // Проверяем хеш нового воркфлоу с хешом в хранилище
          const existingWorkflow = this.workflows[newWorkflow.id];
          const newWorkflowHash = computeWorkflowHash(newWorkflow);
          const existingWorkflowHash = existingWorkflow?.contentHash;
    
          console.log(`Comparing hashes for workflow ${newWorkflow.id}:`);
          console.log(`Existing Hash: ${existingWorkflowHash}`);
          console.log(`New Hash: ${newWorkflowHash}`);
    
          if (existingWorkflow && existingWorkflowHash === newWorkflowHash) {
            console.log(`Workflow ${newWorkflow.id} не изменился, пропускаем обновление.`);
            continue; // Если хеши совпадают, не обновляем
          }
    
          this.workflows[newWorkflow.id] = newWorkflow;
          console.log(`Workflow ${newWorkflow.id} обновлён.`);
        }
      } catch (error) {
        console.error("Ошибка при загрузке новых рабочих процессов:", error);
      }
    }
    
    ,

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

        // Обновляем хеш после изменения данных
        this.workflows[workflowId].contentHash = computeWorkflowHash(this.workflows[workflowId]);
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
    
          // Проверка по хешу, чтобы избежать излишних обновлений
          const currentHash = currentWorkflow.contentHash;
          const newHash = computeWorkflowHash(item); // Вычисляем хеш нового содержимого
    
          if (insert && currentHash !== newHash) {  // Если хеши разные, то обновляем
            const mergedData = deepmerge(this.workflows[item.id], item);
            mergedData.contentHash = newHash;  // Обновляем хеш содержимого
    
            this.workflows[item.id] = mergedData;
            insertedData[item.id] = mergedData;
            console.log(`Workflow ${item.id} обновлён (по хешу).`);
          } else {
            console.log(`Workflow ${item.id} не обновлён (хеши одинаковы).`);
          }
        } else {
          const workflow = defaultWorkflow(item, { duplicateId });
          workflow.contentHash = computeWorkflowHash(workflow); // Вычисляем хеш для нового воркфлоу
          this.workflows[workflow.id] = workflow;
          insertedData[workflow.id] = workflow;
          console.log(`Workflow ${workflow.id} добавлен.`);
        }
      });
    
      await this.saveToStorage('workflows');
    
      return insertedData;
    }
    ,
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

      await browser.storage.local.remove([
        `state:${id}`,
        `draft:${id}`,
        `draft-team:${id}`,
      ]);
      await this.saveToStorage('workflows');

      const { pinnedWorkflows } = await browser.storage.local.get(
        'pinnedWorkflows'
      );
      const pinnedWorkflowIndex = pinnedWorkflows
        ? pinnedWorkflows.indexOf(id)
        : -1;
      if (pinnedWorkflowIndex !== -1) {
        pinnedWorkflows.splice(pinnedWorkflowIndex, 1);
        await browser.storage.local.set({ pinnedWorkflows });
      }

      return id;
    },
  },
});
