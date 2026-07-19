document.getElementById("capture").addEventListener("click", async () => {
  const r = await chrome.runtime.sendMessage({ type: "start-capture" });
  if (r && r.error) {
    document.getElementById("msg").textContent = r.error;
  } else {
    window.close(); // 关闭弹窗,让用户在页面上框选
  }
});

document.getElementById("dash").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "open-dashboard" });
  window.close();
});
