function getCurrentStateHash() {
    // Пример: возвращаем хеш, основанный на текущем состоянии вашего расширения
    // Здесь должно быть ваше логическое вычисление хеша, например:
    // return someHashFunction(state);
    return "some_unique_hash_based_on_state";  // Замените на вашу логику получения хеша
}

// Функция для проверки и обновления состояния расширения
function checkAndUpdateState() {
    let currentHash = getCurrentStateHash();  // Получаем текущий хеш состояния

    // Получаем предыдущий хеш из chrome.storage
    chrome.storage.local.get("previousHash", function(data) {
        if (data.previousHash !== currentHash) {
            // Если хеш изменился, выполняем необходимые действия для обновления
            console.log("Необходимо обновить состояние плагина");

            // Сохраняем новый хеш в chrome.storage
            chrome.storage.local.set({ previousHash: currentHash }, function() {
                console.log("Новый хеш сохранен");
            });
        } else {
            // Если хеш не изменился, плагин не нужно обновлять
            console.log("Плагин уже обновлен");
        }
    });
}

// Проверка состояния при установке расширения
chrome.runtime.onInstalled.addListener(function() {
    console.log("Расширение установлено");
    checkAndUpdateState();  // Проверяем и обновляем состояние
});

// Проверка состояния при запуске браузера
chrome.runtime.onStartup.addListener(function() {
    console.log("Браузер запущен");
    checkAndUpdateState();  // Проверяем и обновляем состояние
});
