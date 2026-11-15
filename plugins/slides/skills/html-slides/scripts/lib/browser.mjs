import fs from "node:fs";
import path from "node:path";
import { attachPage } from "./cdp.mjs";
import { findChrome, launchChrome } from "./chrome.mjs";
import { startServer } from "./server.mjs";

export function isWebUrl(value) {
  return /^https?:\/\//i.test(value);
}

export async function resolvePage(value) {
  if (isWebUrl(value)) return { url: value, close: async () => {} };
  const file = path.resolve(value);
  const info = await fs.promises.stat(file).catch(() => null);
  if (!info?.isFile()) throw new Error(`Page is not a file: ${file}`);
  const server = await startServer(path.dirname(file));
  const encoded = path.basename(file).split(path.sep).map(encodeURIComponent).join("/");
  return { url: `http://127.0.0.1:${server.port}/${encoded}`, close: server.close };
}

export function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

export function waitForEvent(cdp, method, sessionId, milliseconds = 10_000) {
  return withTimeout(new Promise((resolve) => {
    const off = cdp.on(method, (params, eventSessionId) => {
      if (eventSessionId !== sessionId) return;
      off();
      resolve(params);
    });
  }), milliseconds, `Timed out waiting for ${method}`);
}

export async function evaluate(cdp, sessionId, expression, timeout = 10) {
  const response = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId, { timeout });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "Page evaluation failed");
  return response.result?.value;
}

export async function openPage({ url, width, height, env = process.env, beforeNavigate }) {
  const chromePath = findChrome({ env, platform: process.platform });
  const chrome = launchChrome(chromePath, { width, height });
  try {
    const sessionId = await attachPage(chrome.cdp);
    await Promise.all([
      chrome.cdp.send("Page.enable", {}, sessionId),
      chrome.cdp.send("Runtime.enable", {}, sessionId),
      chrome.cdp.send("Network.enable", {}, sessionId),
      chrome.cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId),
    ]);
    const context = beforeNavigate?.(chrome.cdp, sessionId);
    const loaded = waitForEvent(chrome.cdp, "Page.loadEventFired", sessionId, 10_000);
    await chrome.cdp.send("Page.navigate", { url }, sessionId);
    await loaded;
    await evaluate(chrome.cdp, sessionId, `(async()=>{
      if(document.fonts) await document.fonts.ready;
      await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));
      if("__slidesReady" in window) {
        const started=performance.now();
        while(window.__slidesReady!==true) {
          if(performance.now()-started>10000) throw new Error("Timed out waiting for window.__slidesReady === true");
          await new Promise(resolve=>setTimeout(resolve,25));
        }
      }
    })()`, 11);
    return { chrome, sessionId, context };
  } catch (error) {
    await chrome.close();
    throw error;
  }
}

export function installDiagnostics(cdp, sessionId) {
  const diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [], httpErrors: [] };
  const requests = new Map();
  const off = [
    cdp.on("Runtime.consoleAPICalled", (params, eventSessionId) => {
      if (eventSessionId !== sessionId || params.type !== "error") return;
      diagnostics.consoleErrors.push((params.args ?? []).map((arg) => arg.value ?? arg.description ?? arg.type).join(" "));
    }),
    cdp.on("Runtime.exceptionThrown", (params, eventSessionId) => {
      if (eventSessionId !== sessionId) return;
      diagnostics.pageErrors.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "Uncaught page error");
    }),
    cdp.on("Network.requestWillBeSent", (params, eventSessionId) => {
      if (eventSessionId === sessionId) requests.set(params.requestId, params.request?.url ?? "(unknown URL)");
    }),
    cdp.on("Network.responseReceived", (params, eventSessionId) => {
      if (eventSessionId !== sessionId) return;
      if ((params.response?.status ?? 0) >= 400) diagnostics.httpErrors.push({ url: params.response.url, status: params.response.status });
    }),
    cdp.on("Network.loadingFailed", (params, eventSessionId) => {
      if (eventSessionId !== sessionId) return;
      diagnostics.failedRequests.push({ url: requests.get(params.requestId) ?? "(unknown URL)", error: params.errorText ?? "request failed" });
    }),
  ];
  return { diagnostics, close() { for (const remove of off) remove(); } };
}

export function auditExpression(selector) {
  return `(()=>{
    const selector=${JSON.stringify(selector)};
    const slides=[...document.querySelectorAll(selector)];
    const slideId=(element)=>{
      const slide=element.closest(selector);
      if(!slide) return "(outside slides)";
      return slide.id||"slide-"+(slides.indexOf(slide)+1);
    };
    const cssPath=(element)=>{
      const parts=[];
      let node=element;
      while(node&&node.nodeType===1&&parts.length<4){
        let part=node.localName;
        if(node.id){part+="#"+CSS.escape(node.id);parts.unshift(part);break;}
        if(node.classList.length) part+="."+[...node.classList].slice(0,2).map(value=>CSS.escape(value)).join(".");
        parts.unshift(part);
        node=node.parentElement;
      }
      return parts.join(" > ");
    };
    const elements=[];
    const textBlocks=[];
    for(const element of document.querySelectorAll("body *")){
      const style=getComputedStyle(element);
      const rendered=element.getClientRects().length>0&&style.display!=="none";
      if(!rendered) continue;
      const compactColor=style.color.replaceAll(" ","");
      const colorAlphaZero=compactColor==="transparent"||(compactColor.startsWith("rgba(")&&compactColor.endsWith(",0)"))||(compactColor.includes("/")&&compactColor.endsWith("/0)"));
      let ancestorOpacityZero=false;
      for(let node=element;node;node=node.parentElement){
        if(Number.parseFloat(getComputedStyle(node).opacity)===0){ancestorOpacityZero=true;break;}
      }
      const visibilityHidden=['hidden','collapse'].includes(style.visibility);
      const direct=[...element.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE&&/\\S/u.test(node.textContent||""));
      const text=direct.map(node=>node.textContent).join(" ").replace(/\\s+/gu," ").trim();
      if(text) textBlocks.push({slideId:slideId(element),text});
      const rect=element.getBoundingClientRect();
      const textRects=[];
      for(const node of direct){
        const range=document.createRange();
        range.selectNodeContents(node);
        for(const item of range.getClientRects()) textRects.push({left:item.left,right:item.right});
      }
      const innerText=(element.innerText||"").replace(/\\s+/gu," ").trim();
      if(textRects.length||innerText){
        elements.push({
          rendered:true,
          colorAlphaZero,
          ancestorOpacityZero,
          visibilityHidden,
          slideId:slideId(element),
          path:cssPath(element),
          text:text||innerText,
          textRects,
          paddingBox:{left:rect.left+parseFloat(style.borderLeftWidth||0),right:rect.right-parseFloat(style.borderRightWidth||0)},
          overflowX:style.overflowX,
          overflowY:style.overflowY,
          scrollWidth:element.scrollWidth,
          scrollHeight:element.scrollHeight,
          clientWidth:element.clientWidth,
          clientHeight:element.clientHeight
        });
      }
    }
    return {
      innerWidth:window.innerWidth,
      scrollWidth:document.documentElement.scrollWidth,
      hasDeclaredIcon:Boolean(document.querySelector('link[rel~="icon" i]')),
      slides:slides.map((slide,index)=>({id:slide.id||"slide-"+(index+1),text:slide.innerText||""})),
      images:[...document.images].map(image=>({src:image.currentSrc||image.src,naturalWidth:image.naturalWidth})),
      elements,
      textBlocks
    };
  })()`;
}
