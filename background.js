// Open the tracker in Chrome's side panel when the toolbar icon is clicked.
// The side panel is natively resizable by dragging its inner edge.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.error("sidePanel behavior:", e));
