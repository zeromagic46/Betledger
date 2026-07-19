// BetLedger 区域框选:注入到目标页面,拖拽选择注单区域
(() => {
  if (window.__betledgerSelecting) return;
  window.__betledgerSelecting = true;

  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", zIndex: "2147483647",
    cursor: "crosshair", background: "rgba(14,18,22,0.35)",
  });
  const tip = document.createElement("div");
  tip.textContent = "拖拽框选注单区域,Esc 取消";
  Object.assign(tip.style, {
    position: "fixed", top: "16px", left: "50%", transform: "translateX(-50%)",
    background: "#171717", color: "#5ea0ff", padding: "8px 16px",
    borderRadius: "6px", font: "13px/1.4 'Microsoft YaHei',sans-serif",
    border: "1px solid rgba(255,255,255,.14)", zIndex: "2147483647", pointerEvents: "none",
  });
  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "fixed", border: "2px solid #5ea0ff",
    background: "rgba(94,160,255,0.15)", display: "none", zIndex: "2147483647",
    pointerEvents: "none",
  });
  document.documentElement.append(overlay, tip, box);

  let sx = 0, sy = 0, dragging = false;

  function cleanup() {
    overlay.remove(); tip.remove(); box.remove();
    window.__betledgerSelecting = false;
    document.removeEventListener("keydown", onKey, true);
  }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); cleanup(); }
  }
  document.addEventListener("keydown", onKey, true);

  overlay.addEventListener("mousedown", (e) => {
    dragging = true; sx = e.clientX; sy = e.clientY;
    Object.assign(box.style, { left: sx + "px", top: sy + "px", width: "0", height: "0", display: "block" });
    e.preventDefault();
  });
  overlay.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
    const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
    Object.assign(box.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
  });
  overlay.addEventListener("mouseup", (e) => {
    if (!dragging) return;
    dragging = false;
    const rect = {
      x: Math.min(sx, e.clientX), y: Math.min(sy, e.clientY),
      w: Math.abs(e.clientX - sx), h: Math.abs(e.clientY - sy),
    };
    cleanup();
    if (rect.w < 10 || rect.h < 10) return;
    chrome.runtime.sendMessage({ type: "area-selected", rect, dpr: window.devicePixelRatio || 1 });
  });
})();
