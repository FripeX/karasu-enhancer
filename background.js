chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "notify") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon.png"),
      title: request.title,
      message: request.message,
      priority: 2,
    });
  }
});
