// ==UserScript==
// @name         PTE  Pixiv→Eagle
// @name:en      PTE  Minimal Pixiv→Eagle
// @author      Mliechoy
// @version      0.9.8.3
// @description        一键导入 Pixiv→Eagle（含 ugoira→GIF）；支持详情/列表/勾选；实时进度/ETA/可取消；面板可拖动并记忆位置；本地通信。
// @description:en     One-click import Pixiv to Eagle (ugoira→GIF); detail/list/selected modes; progress & ETA; cancel; draggable panel with position memory; local only.
// @description:ja      Pixiv を Eagle にワンクリックで取り込み（ugoira→GIF 含む）；詳細/一覧/選択の取り込み；進捗・ETA・キャンセル；ドラッグ可能＆位置記憶のパネル；ローカル通信。
// @description:zh-TW   一鍵匯入 Pixiv 至 Eagle（含 ugoira→GIF）；支援詳情/列表/勾選；進度列/ETA/可取消；面板可拖曳並記憶位置；僅本機通訊。
// @match        https://www.pixiv.net/*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @connect      localhost
// @connect      127.0.0.1
// @connect      i.pximg.net
// @connect      cdn.jsdelivr.net
// @run-at       document-idle
// @license      MIT
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.min.js
// @require      https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.min.js
// @namespace https://pte-script.example
// @author      Mliechoy
// @downloadURL https://update.greasyfork.org/scripts/552563/PTE%20%20Pixiv%E2%86%92Eagle.user.js
// @updateURL https://update.greasyfork.org/scripts/552563/PTE%20%20Pixiv%E2%86%92Eagle.meta.js
// ==/UserScript==
/* eslint-env browser */

(function(){'use strict';

/******************** 常量 & 工具 ********************/
const EAGLE={ base:'http://localhost:41595', api:{ add:'/api/item/addFromURLs', list:'/api/folder/list', create:'/api/folder/create', update:'/api/folder/update' } };
const LSKEY='pxeMini';
const LS={ get(k,d){ try{ return JSON.parse(localStorage.getItem(LSKEY+':'+k)) ?? d; }catch{ return d; } },
          set(k,v){ try{ localStorage.setItem(LSKEY+':'+k, JSON.stringify(v)); }catch{} } };
const sanitize=s=>(s||'').replace(/[\r\n]+/g,' ').replace(/[\/\\:*?"<>|]/g,'_').trim();
const lower=s=>(s||'').toLowerCase();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/******************** 运行参数 ********************/
const CFG={ filters:{ bookmarkMin:0, includeTags:'', pageRange:'' }, ui:{ x:24, y:24, margin:16 }, feature:{ useUploadAsAddDate: !!LS.get('useUploadAsAddDate', false) } , mode: LS.get('mode','eagle') };

/******************** Eagle API ********************/
function xhr({url,method='GET',data=null}){
  return new Promise((resolve,reject)=>{
    GM_xmlhttpRequest({
      url, method, data: data?JSON.stringify(data):null,
      headers:{'Content-Type':'application/json'},
      onload:(res)=>{ try{ resolve(JSON.parse(res.responseText||'{}')); }catch{ resolve({}); } },
      onerror:()=>reject(new Error('Eagle连接失败'))
    });
  });
}
async function listFolders(){ const r=await xhr({url:EAGLE.base+EAGLE.api.list}); return (r&&r.data)||r.folders||[]; }
async function createFolder(name, parentId){
  const payload = parentId ? {folderName:name, parent: parentId} : {folderName:name, isRoot:true};
  const r=await xhr({url:EAGLE.base+EAGLE.api.create, method:'POST', data:payload});
  return r?.data?.id || r?.id || r?.folderId;
}
async function updateFolderDesc(id, desc){
  await xhr({url:EAGLE.base+EAGLE.api.update, method:'POST', data:{folderId:id, newDescription:desc, description:desc}});
}
function flattenFolders(tree){
  const out=[]; const st=[...(Array.isArray(tree)?tree:[tree])].filter(Boolean);
  while(st.length){ const f=st.shift(); out.push(f); if(f.children&&f.children.length) st.push(...f.children); }
  return out;
}
async function addToEagle(items, folderId){
  return await xhr({url:EAGLE.base+EAGLE.api.add, method:'POST', data:{items, folderId}});
}

/******************** 页面工具 ********************/
const aborters=new Set();
function cancelInflight(){ for(const a of aborters){ try{a.abort();}catch{} } aborters.clear(); }
async function getJSON(url){ const c=new AbortController(); aborters.add(c); try{ const r=await fetch(url,{credentials:'include',signal:c.signal}); return await r.json(); } finally{ aborters.delete(c);} }
async function getTEXT(url){ const c=new AbortController(); aborters.add(c); try{ const r=await fetch(url,{credentials:'include',signal:c.signal}); return await r.text(); } finally{ aborters.delete(c);} }

function isUser(){ return /\/users\/\d+/.test(location.pathname); }
function isArtwork(){ return /\/artworks\/\d+/.test(location.pathname); }

async function allIllustIds(uid){ const r=await getJSON(`https://www.pixiv.net/ajax/user/${uid}/profile/all`); const ill=r.body?.illusts?Object.keys(r.body.illusts):[]; const man=r.body?.manga?Object.keys(r.body.manga):[]; return [...new Set([...ill,...man])]; }
function ogTitle(html){ const m=html.match(/<meta[^>]+property=['"]og:title['"][^>]*content=['"]([^'"]+)['\"]/i); return m?sanitize(m[1]):''; }
async function illustInfoAndPages(id){
  const tryFetch=async()=>{
    const info=await getJSON(`https://www.pixiv.net/ajax/illust/${id}`);
    const pages=await getJSON(`https://www.pixiv.net/ajax/illust/${id}/pages`);
    const b=info.body||{}; const pageUrls=(pages.body||[]).map(p=>p.urls?.original).filter(Boolean);
    const tagList=Array.isArray(b.tags?.tags)?b.tags.tags:[];
    const tags=tagList.map(t=>t?.tag||t?.translation?.en||t?.translation?.ja||'').filter(Boolean);
    return {
      title:sanitize(b.title||`pixiv_${id}`),
      tags, pageUrls,
      userId:b.userId, userName:sanitize(b.userName||b.userAccount||''),
      illustType:b.illustType, bookmarkCount:b.bookmarkCount||0,
      uploadDate:b.uploadDate
    };
  };
  let meta=await tryFetch();
  if((!meta.tags?.length)||/^pixiv_\d+$/.test(meta.title)){
    for(let i=0;i<2;i++){ await sleep(180+i*180); const nx=await tryFetch();
      if(!meta.tags?.length && nx.tags?.length) meta.tags=nx.tags;
      if(/^pixiv_\d+$/.test(meta.title) && !/^pixiv_\d+$/.test(nx.title)) meta.title=nx.title;
      if(!meta.uploadDate && nx.uploadDate) meta.uploadDate=nx.uploadDate;
    }
    if(/^pixiv_\d+$/.test(meta.title)){ try{ const html=await getTEXT(`https://www.pixiv.net/artworks/${id}`); const og=ogTitle(html); if(og) meta.title=og; }catch{} }
  }
  if(!meta.tags?.length){ meta.tags = meta.userName?[meta.userName]:[]; } else { meta.tags = Array.from(new Set([meta.userName, ...meta.tags].filter(Boolean))); }
  return meta;
}
async function ugoiraMeta(id){ return await getJSON(`https://www.pixiv.net/ajax/illust/${id}/ugoira_meta`); }
function parseRange(str){ if(!str) return null; const s=str.trim(); if(!s) return null;
  const a=s.match(/^(\d+)-(\d+)$/); if(a){ const x=+a[1],y=+a[2]; if(x>0 && y>=x) return [x,y]; }
  const b=s.match(/^(\d+)$/); if(b){ const n=+b[1]; if(n>0) return [n,n]; } return null; }

/******************** Ugoira→GIF 工具 ********************/

/******************** 模式 & 本地下载工具 ********************/
const COLOR = { eagle:'#409eff', disk:'#f1a72e' }; // 蓝(鹰) / 偏黄(本地)
function fmtIndex(i, total){ const w = String(total).length; return String(i).padStart(w, '0'); }
function inferExtFromUrl(u){
  const m = u.match(/\.([a-zA-Z0-9]+)(?:\?|$)/); return m ? ('.'+m[1].toLowerCase()) : '.jpg';
}

function gmDownloadWithHeaders(url, name, headers){
  // Disk 模式 + 已选择目录：用 FS 写入（支持作者名_作者ID 子目录）
  if (typeof PTE_FS !== 'undefined' && PTE_FS && PTE_FS.root && (typeof CFG==='object') && CFG.mode === 'disk') {
    return (async () => {
      const ab = await gmFetchBinary(url, { headers: headers || {} });
      const blob = new Blob([ab]);
      await saveBlobAsWithPath(name, blob);
    })();
  }
  // 回退：GM_download（无法创建子目录，仅作兜底）
  return new Promise((resolve,reject)=>{
    try{
      GM_download({
        url,
        name,
        saveAs: false,
        headers: headers || {},
        onload: resolve,
        onerror: reject,
        ontimeout: reject
      });
    }catch(e){ reject(e); }
  });
}

// ====== FS Access helpers (user-gesture required once) ======
let PTE_FS = { root: null, picked: false };
async function ptePickDownloadsRoot(){
  if(!('showDirectoryPicker' in window)){ alert('当前浏览器不支持选择目录（需要 Chrome/Edge 版本较新）'); return false; }
  try{
    const root = await window.showDirectoryPicker({ id:'pte-download-root', mode:'readwrite', startIn:'downloads' });
    PTE_FS.root = root; PTE_FS.picked = true;
    alert('已选择下载目录：Downloads/Pixiv');
    return true;
  }catch(e){
    console.warn('目录选择取消或失败', e);
    alert('未选择目录，继续使用浏览器默认下载（无法创建子文件夹）');
    return false;
  }
}
async function pteSaveWithFS(path, blob){
  if(!PTE_FS.root) return false;
  try{
    const parts = path.split('/').filter(Boolean);
    let dir = PTE_FS.root;
    for(let i=0;i<parts.length-1;i++){
      dir = await dir.getDirectoryHandle(parts[i], { create:true });
    }
    const fname = parts[parts.length-1];
    const fileHandle = await dir.getFileHandle(fname, { create:true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  }catch(e){
    console.warn('FS Access 写入失败，回退 GM_download', e);
    return false;
  }
}

async function saveBlobAsWithPath(path, blob){
  const url = URL.createObjectURL(blob);
  try{
    if(PTE_FS.root){
      const ok = await pteSaveWithFS(path, blob);
      if(ok){ URL.revokeObjectURL(url); return; }
    }
  }catch(e){ console.warn(e); }
  return new Promise((resolve,reject)=>{
    const cleanup = ()=>{ setTimeout(()=>URL.revokeObjectURL(url), 2000); };
    try{
      GM_download({ url, name: path, saveAs:false,
        onload: ()=>{ cleanup(); resolve(); },
        onerror: (e)=>{ cleanup(); reject(e); },
        ontimeout: (e)=>{ cleanup(); reject(e); }
      });
    }catch(e){ cleanup(); reject(e); }
  });
}

function gmFetchBinary(url, options = {}){
  return new Promise((resolve, reject)=>{
    GM_xmlhttpRequest({
      method: options.method || 'GET',
      url, data: options.body,
      headers: options.headers || {},
      responseType: options.responseType || 'arraybuffer',
      onload: res => resolve(res.response),
      onerror: reject
    });
  });
}
function gmFetchText(url, options = {}){
  return new Promise((resolve, reject)=>{
    GM_xmlhttpRequest({
      method: options.method || 'GET',
      url, data: options.body,
      headers: options.headers || {},
      responseType: 'text',
      onload: res => resolve(res.responseText || res.response),
      onerror: reject
    });
  });
}
async function ensureFflateLoaded(){
  if (window.fflate) return;
  throw new Error('fflate 未加载（@require 失败）');
}
let __gifWorkerURL = null;
async function ensureGifLibLoaded(){
  if (!window.GIF) throw new Error('gif.js 未加载（@require 失败）');
  if (!__gifWorkerURL){
    const workerCode = await gmFetchText('https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js');
    __gifWorkerURL = URL.createObjectURL(new Blob([workerCode], {type:'text/javascript'}));
  }
}
function guessMime(name){ return name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'; }
function decodeImageFromU8(u8, mime){
  return new Promise((resolve,reject)=>{
    const blob = new Blob([u8], {type:mime});
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = ()=>{ URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e)=>{ URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
async function convertUgoiraToGifBlob(artId){
  await ensureFflateLoaded();
  await ensureGifLibLoaded();
  const meta = await ugoiraMeta(artId);
  const zipUrl = meta?.body?.originalSrc || meta?.body?.src;
  const frames = meta?.body?.frames || [];
  if(!zipUrl || !frames.length) throw new Error('无法获取动图元数据');
  const zipBuf = await gmFetchBinary(zipUrl, { responseType:'arraybuffer', headers:{ referer:'https://www.pixiv.net/' } });
  const entries = window.fflate.unzipSync(new Uint8Array(zipBuf));
  const first = frames[0];
  const firstBytes = entries[first.file];
  if(!firstBytes) throw new Error('压缩包缺少首帧: ' + first.file);
  const firstImg = await decodeImageFromU8(firstBytes, guessMime(first.file));
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently:true });
  canvas.width = firstImg.width; canvas.height = firstImg.height;
  const gif = new window.GIF({ workers:2, quality:10, width:canvas.width, height:canvas.height, workerScript: __gifWorkerURL });
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(firstImg,0,0);
  gif.addFrame(ctx, { copy:true, delay: Math.max(20, first.delay||100) });
  for(let i=1;i<frames.length;i++){
    const f = frames[i];
    const bytes = entries[f.file];
    if(!bytes) throw new Error('压缩包缺少帧: ' + f.file);
    const img = await decodeImageFromU8(bytes, guessMime(f.file));
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0);
    gif.addFrame(ctx, { copy:true, delay: Math.max(20, f.delay||100) });
  }
  const blob = await new Promise(resolve=>{ gif.on('finished', b=>resolve(b)); gif.render(); });
  return blob;
}
function blobToDataURL(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=reject;
    reader.readAsDataURL(blob);
  });
}
async function gifAsBlobAndDataURL(artId, title, opts={saveLocal:true, savePath:null}){

  const blob = await convertUgoiraToGifBlob(artId);
  const dataURL = await blobToDataURL(blob);
  const name = `${artId}.gif`;
  // 先保存本地，再导入 Eagle

  if(opts.saveLocal){
    if(opts.savePath){ await saveBlobAsWithPath(opts.savePath, blob); }
    else { saveBlobAs(name, blob); }
  }
  return { blob, dataURL, name };
}
function saveBlobAs(filename, blob){
  const url = URL.createObjectURL(blob);
  const cleanup = ()=> setTimeout(()=>URL.revokeObjectURL(url), 2000);
  try{
    if(typeof GM_download === 'function'){
      GM_download({ url, name: filename, saveAs: false, onload: cleanup, ontimeout: cleanup, onerror: ()=>{ cleanup(); fallback(); } });
      return;
    }
  }catch{ cleanup(); }
  fallback();
  function fallback(){
    const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); cleanup();
  }
}

/******************** 导入 / 合并行为 ********************/
async function importMode(mode){
  cancel=false; aborters.clear();

  if(mode==='one'){
    const id=location.pathname.match(/artworks\/(\d+)/)?.[1];
    if(!id){ return alert('未识别到作品ID'); }
    return importOne(id, /*mergeGif*/ true);
  }

  showScan();

  let ids=[]; const onUser = isUser();

  if(mode==='selected'){
    const cbs=[...document.querySelectorAll('.pxe-mini-checkbox:checked')];
    ids=[...new Set(cbs.map(cb=>cb.dataset.id).filter(Boolean))];
    updScan(ids.length,0,true);
  } else if(mode==='page'){
    ids = collectIdsFromPage(); updScan(ids.length,0,true);
  } else if(mode==='all'){
    if(onUser){
      const m=location.pathname.match(/users\/(\d+)/); if(!m){ closeScan(); return alert('未识别到用户ID'); }
      const uid=m[1]; ids=await allIllustIds(uid); updScan(ids.length,0,true);
    }else{
      ids = collectIdsFromPage(); updScan(ids.length,0,true);
    }
  }

  if(cancel){ closeScan(); return; }
  if(!ids.length){ closeScan(); return alert(mode==='selected' ? '请先勾选作品' : '未在本页找到作品'); }

  const wants=(CFG.filters.includeTags||'').split(',').map(s=>lower(s.trim())).filter(Boolean);
  closeScan(); showImport(ids.length); let kept=[]; let done=0; let ok=0; updImport(0, ids.length, 0);
for(const id of ids){
    if(cancel) break;
    try{
      const info=await illustInfoAndPages(id); if(cancel) break;
      const baseCommon = { website:`https://www.pixiv.net/artworks/${id}` };
      const modTime = (CFG.feature.useUploadAsAddDate && info.uploadDate) ? new Date(info.uploadDate).getTime() : undefined;
      if(CFG.mode==='eagle'){
        let items=[];
        if(info.illustType===2){
          const { dataURL, name } = await gifAsBlobAndDataURL(id, info.title, { saveLocal:false });
          const one = { url:dataURL, name:name, tags:Array.from(new Set([...(info.tags||[]), info.userName].filter(Boolean))) };
          if(modTime) one.modificationTime = modTime;
          items.push({ ...baseCommon, ...one });
        } else {
          const rng=parseRange(CFG.filters.pageRange); const urls=info.pageUrls||[];
          let use=urls; if(rng) use=urls.filter((_,i)=>{ const p=i+1; return p>=rng[0] && p<=rng[1]; });
          let i=0;
          items = use.map(u=>{
            const one = { url:u, name: use.length>1? `${info.title}_p${++i}` : info.title, tags:Array.from(new Set([...(info.tags||[]), info.userName].filter(Boolean))), headers:{ referer:'https://www.pixiv.net/' } };
            if(modTime) one.modificationTime = modTime;
            return { ...baseCommon, ...one };
          });
        }
        const fid=await ensureArtistFolder(info.userId, info.userName);
        if(items.length){ await addToEagle(items,fid); ok++; }
      } else {
        // Disk 模式：保存到 Downloads/Pixiv/作者ID/ 目录
        const safeUser = sanitize(info.userName||("Pixiv_"+info.userId));
          const baseDir = `${safeUser}_${info.userId}`;
        if(info.illustType===2){
          const savePath = `${baseDir}/${id}.gif`;
          await gifAsBlobAndDataURL(id, info.title, { saveLocal:true, savePath });
          ok++;
        } else {
          const rng=parseRange(CFG.filters.pageRange); const urls=info.pageUrls||[];
          let use=urls; if(rng) use=urls.filter((_,i)=>{ const p=i+1; return p>=rng[0] && p<=rng[1]; });
          const total = use.length || 1;
          for(let i=0;i<use.length;i++){
            const u=use[i]; const ext=inferExtFromUrl(u);
            const fname = total>1 ? `${baseDir}/${id}_${fmtIndex(i+1,total)}${ext}` : `${baseDir}/${id}${ext}`;
            await gmDownloadWithHeaders(u, fname, { referer:'https://www.pixiv.net/' });
          }
          ok++;
        }
      }
    }catch(e){ console.warn('[导入失败]', id, e); }
    done++; updImport(done, ids.length, ok); await sleep(120); if(cancel) break;
  }
  alert(cancel? `已取消。处理${done}，成功${ok}` : `导入完成！处理${done}，成功${ok}`);
  document.getElementById('pxeMiniProg')?.remove();
}

async function importOne(id, mergeGif=false){
  cancel=false;
  try{
    const info=await illustInfoAndPages(id);
    const baseCommon = { website:`https://www.pixiv.net/artworks/${id}` };
    const modTime = (CFG.feature.useUploadAsAddDate && info.uploadDate) ? new Date(info.uploadDate).getTime() : undefined;
    const rng=parseRange(CFG.filters.pageRange); const urls=info.pageUrls||[];
    if(CFG.mode==='eagle'){
      const fid=await ensureArtistFolder(info.userId, info.userName);
      let items=[];
      if(info.illustType===2){
        // 生成 GIF -> 仅导入，不保留本地文件
        const { dataURL, name } = await gifAsBlobAndDataURL(id, info.title, { saveLocal:false });
        const one = { url:dataURL, name:name, tags:Array.from(new Set([...(info.tags||[]), info.userName].filter(Boolean))) };
        if(modTime) one.modificationTime = modTime;
        items.push({ ...baseCommon, ...one });
      } else {
        let use=urls; if(rng) use=urls.filter((_,i)=>{ const p=i+1; return p>=rng[0] && p<=rng[1]; }); let i=0;
        items = use.map(u=>{
          const one = { url:u, name: use.length>1? `${info.title}_p${++i}` : info.title, tags:Array.from(new Set([...(info.tags||[]), info.userName].filter(Boolean))), headers:{ referer:'https://www.pixiv.net/' } };
          if(modTime) one.modificationTime = modTime;
          return { ...baseCommon, ...one };
        });
      }
      if(items.length){ await addToEagle(items,fid); }
      alert('已完成：已发送到 Eagle' + (info.illustType===2 ? '（GIF 已导入）' : ''));
    } else {
      // Disk 模式：保存到 Downloads/Pixiv/作者ID/ 目录
      const safeUser = sanitize(info.userName||("Pixiv_"+info.userId));
          const baseDir = `${safeUser}_${info.userId}`;
      if(info.illustType===2){
        const savePath = `${baseDir}/${id}.gif`;
        await gifAsBlobAndDataURL(id, info.title, { saveLocal:true, savePath });
      } else {
        let use=urls; if(rng) use=urls.filter((_,i)=>{ const p=i+1; return p>=rng[0] && p<=rng[1]; });
        const total = use.length || 1;
        for(let i=0;i<use.length;i++){
          const u=use[i]; const ext=inferExtFromUrl(u);
          const fname = total>1 ? `${baseDir}/${id}_${fmtIndex(i+1,total)}${ext}` : `${baseDir}/${id}${ext}`;
          await gmDownloadWithHeaders(u, fname, { referer:'https://www.pixiv.net/' });
        }
      }
      alert(`已完成：已保存到本地 ${baseDir}`);
    }
  }catch(e){ alert('发送/下载失败：'+(e&&e.message||e)); }
}


/******************** 作者文件夹 ********************/
async function ensureArtistFolder(uid, userName, parentId=null){
  const folders = await listFolders();
  const all = flattenFolders(folders);
  const pidRe = /pid\s*=\s*(\d+)/;
  const uidStr = String(uid);
  const hit = all.find(f=>{
    const m=(f.description||'').match(pidRe);
    return m && m[1]===uidStr;
  });
  if(hit) return hit.id;
  const safe = sanitize(userName||('Pixiv_'+uid));
  const same = all.find(f => (f.folderName||f.name) === safe);
  if(same){ try{ await updateFolderDesc(same.id, `pid = ${uidStr}`); }catch{} return same.id; }
  const id = await createFolder(safe, parentId);
  try{ await updateFolderDesc(id, `pid = ${uidStr}`); }catch{}
  return id;
}

/******************** 勾选框（同 0.9.5.4） ********************/
let lastChecked=null;
function addCheck(a){
  const m=a.href.match(/artworks\/(\d+)/); if(!m) return;
  const id=m[1];
  if(document.querySelector(`.pxe-mini-checkbox[data-id="${id}"]`)) return;
  let host = a.closest('div[role="listitem"], div[data-testid], figure, li, article, a');
  if(!host) host = a.parentElement || a;
  function findPositionedAncestor(el){
    let p = el;
    while (p && p !== document.body){
      const pos = getComputedStyle(p).position;
      if (pos && pos !== 'static') return p;
      p = p.parentElement;
    }
    return null;
  }
  const container = findPositionedAncestor(host) || host;
  const cb=document.createElement('input');
  cb.type='checkbox';
  cb.className='pxe-mini-checkbox';
  cb.dataset.id=id;
  Object.assign(cb.style,{
    position:'absolute', top:'6px', left:'6px', zIndex:2147483001,
    width:'18px', height:'18px', accentColor:'#409EFF', cursor:'pointer'
  });
  cb.addEventListener('click',(e)=>{
    e.stopPropagation();
    if(e.shiftKey && lastChecked){
      const all = Array.from(new Map(Array.from(document.querySelectorAll('.pxe-mini-checkbox')).map(x=>[x.dataset.id,x])).values());
      const i1=all.indexOf(lastChecked), i2=all.indexOf(cb);
      const [s,e2]=[Math.min(i1,i2), Math.max(i1,i2)];
      for(let i=s;i<=e2;i++) all[i].checked=cb.checked;
    }
    lastChecked = cb.checked? cb : null;
  });
  container.appendChild(cb);
}
function scan(){ document.querySelectorAll('a[href*="/artworks/"]:not([data-pxe-mini])').forEach(a=>{ a.dataset.pxeMini=1; addCheck(a); }); }
function watch(){ scan(); if(!watch._mo){ watch._mo=new MutationObserver(m=>{ if(m.some(x=>x.addedNodes.length)) scan(); }); watch._mo.observe(document.body,{childList:true,subtree:true}); }}

/******************** 进度条盒子 & UI ********************/
let cancel=false, t0=0;
function box(id, title){
  const w=document.createElement('div'); w.id=id; Object.assign(w.style,{ position:'fixed', top:'14px', right:'14px', zIndex:2147483000 });
  w.innerHTML=`<div style="width:334px;padding:8px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.18);background:#fff;font-size:12px;">
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
      <div id="${id}-left" style="display:flex;align-items:center;gap:6px;">
        <div style="font-weight:600;color:#333;white-space:nowrap;">${title}</div>
        <button id="${id}-led" title="检查 Eagle (点击重载工具条)" style="border:none;background:transparent;padding:0;cursor:pointer;line-height:1;">●</button>
      </div>
      <div id="${id}-eta" style="margin-left:6px;color:#888;font-size:12px;"></div>
      <button id="${id}-close" style="margin-left:auto;padding:2px 6px;border:none;background:#909399;color:#fff;border-radius:4px;cursor:pointer;">关闭</button>
    </div>
    <div style="flex:1;border:1px solid #e6e6e6;height:16px;border-radius:4px;overflow:hidden;background:#f5f7fa;margin-bottom:6px;">
      <div id="${id}-bar" style="width:0%;height:100%;background:#409eff;color:#fff;text-align:center;line-height:16px;">0%</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;">
      <div id="${id}-txt" style="color:#666;"></div>
      <button id="${id}-cancel" style="margin-left:auto;padding:2px 6px;border:none;background:#f56c6c;color:#fff;border-radius:4px;cursor:pointer;">取消</button>
    </div>
  </div>`;
  document.body.appendChild(w);
  w.querySelector(`#${id}-close`).onclick=()=>w.remove();
  w.querySelector(`#${id}-cancel`).onclick=()=>{ if(cancel) return; cancel=true; cancelInflight(); const b=w.querySelector(`#${id}-bar`); b.style.background='#f56c6c'; b.textContent='取消中...'; };
  w.querySelector(`#${id}-led`).onclick=()=>{ document.getElementById('pxeMiniBar')?.remove(); setTimeout(mountBar,0); checkEagleLed(w.querySelector(`#${id}-led`)); };
  checkEagleLed(w.querySelector(`#${id}-led`));
  return w;
}
function showScan(){ cancel=false; t0=Date.now(); document.getElementById('pxeScan')?.remove(); const el=box('pxeScan','扫描作品'); el.querySelector('#pxeScan-txt').textContent='正在收集作品ID...'; updScan(0,0,true); }
function updScan(done,total,collectPhase){
  const b=document.querySelector('#pxeScan-bar'); const t=document.querySelector('#pxeScan-txt'); const e=document.querySelector('#pxeScan-eta');
  if(collectPhase){ b.style.width='30%'; b.textContent='收集中'; t.textContent=`已找到 ${done} 个作品ID`; }
  else { const p= total>0? Math.round(done/total*100):0; b.style.width=Math.max(31,p)+'%'; b.textContent=`${p}%`; t.textContent=`获取作品信息 ${done} / ${total}`; const dt=(Date.now()-t0)/1000; const rate=done/(dt||1); const remain=total-done; const eta=rate>0?Math.round(remain/rate):0; if(e) e.textContent=`ETA ${Math.floor(eta/60)}m${eta%60}s`; }
}
function closeScan(){ document.getElementById('pxeScan')?.remove(); }
function showImport(total){ cancel=false; t0=Date.now(); document.getElementById('pxeMiniProg')?.remove(); const el=box('pxeMiniProg','PTE'); el.querySelector('#pxeMiniProg-txt').textContent=`0 / ${total} 作品`; }
function updImport(done,total,ok=0){
  const p=Math.round(done/total*100);
  const b=document.querySelector('#pxeMiniProg-bar'); const t=document.querySelector('#pxeMiniProg-txt'); const e=document.querySelector('#pxeMiniProg-eta');
  if(b){ b.style.width=p+'%'; b.textContent=`${p}% (成功:${ok})`; }
  if(t){ t.textContent=`${done} / ${total} 作品 (成功:${ok})`; }
  const dt=(Date.now()-t0)/1000; const rate=done/(dt||1); const remain=total-done; const eta=rate>0? Math.round(remain/rate):0;
  if(e){ e.textContent=`ETA ${Math.floor(eta/60)}m${eta%60}s`; }
  if(done===total && !cancel){ setTimeout(()=>document.getElementById('pxeMiniProg')?.remove(), 1200); }
}

/******************** Eagle 连接指示 ********************/
async function checkEagle(){ try{ const r=await xhr({url:EAGLE.base+EAGLE.api.list}); return !!(r && (r.data||r.folders)); } catch{ return false; } }
async function checkEagleLed(el){
  const ok=await checkEagle();
  if(!el) return ok;
  el.textContent='●';
  el.style.color = ok ? '#10b981' : '#ef4444';
  el.title = (ok?'Eagle 已连接':'Eagle 未连接') + '（点击重载工具条）';
  return ok;
}

/******************** 收集ID ********************/
function collectIdsFromPage(){
  const anchors=Array.from(document.querySelectorAll('a[href*="/artworks/"]'));
  return [...new Set(anchors.map(a=>a.href.match(/artworks\/(\d+)/)?.[1]).filter(Boolean))];
}

/******************** 极简长条 UI（保持 0.9.5.4） ********************/
function isCollapsed(){ return !!LS.get('collapsed', false); }
function setCollapsed(v, pos){
  LS.set('collapsed', !!v);
  const bar = document.getElementById('pxeMiniBar');
  if (!v) {
    // 还原：优先用当前小圆点中心作为 anchor
    if (bar) {
      try{
        const r = bar.getBoundingClientRect();
        const anchor = { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
        localStorage.setItem(LSKEY+':anchor', JSON.stringify(anchor));
        // 同时把当前左上角写回 barPos，作为还原时的基准
        LS.set('barPos', { x: Math.round(r.left), y: Math.round(r.top) });
      }catch{}
      bar.remove();
    }
    // 重新挂载为面板
    mountBar();
    return;
  } else {
    // 缩小：允许传入目标左上角 pos（来自缩小按钮计算），否则保留现有 barPos
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
      LS.set('barPos', { x: Math.floor(pos.x), y: Math.floor(pos.y) });
    }
    if (bar) bar.remove();
    mountBar();
    return;
  }
}
function enableCollapsedDragOrClick(bar, m){
  let dragging=false, moved=false, sx=0, sy=0;

  function clamp(x,y,w,h){
    const nx = Math.min(window.innerWidth - m - w, Math.max(m, x));
    const ny = Math.min(window.innerHeight - m - h, Math.max(m, y));
    return {x:nx, y:ny};
  }

  bar.addEventListener('pointerdown',(ev)=>{
    dragging=true; moved=false; sx=ev.clientX; sy=ev.clientY;
    try{ bar.setPointerCapture(ev.pointerId); }catch{}
    bar.style.cursor='grabbing';
  });

  bar.addEventListener('pointermove',(ev)=>{
    if(!dragging) return;
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    const r = bar.getBoundingClientRect();
    const w=r.width, h=r.height;
    const pos = clamp(r.left + dx, r.top + dy, w, h);
    bar.style.left = pos.x + 'px';
    bar.style.top = pos.y + 'px';
    sx = ev.clientX; sy = ev.clientY;
  });

  function finish(ev){
    if(!dragging) return;
    dragging=false; bar.style.cursor='grab';
    try{
      const r = bar.getBoundingClientRect();
      localStorage.setItem(LSKEY+':barPos', JSON.stringify({x:Math.round(r.left), y:Math.round(r.top)}));
    }catch{}
    if(!moved){
      // 视为点击：展开面板
      setCollapsed(false);
    }
    try{ bar.releasePointerCapture(ev.pointerId); }catch{}
  }

  bar.addEventListener('pointerup', finish);
  bar.addEventListener('pointercancel', finish);
}

/** 拖动整块面板（非最小化状态）。handleEl 存在时，只允许拖动 handleEl 区域 */
function enableDrag(box, margin, handleEl){
  const target = handleEl || box;
  let dragging=false, sx=0, sy=0;

  function clamp(x,y,w,h){
    const nx = Math.min(window.innerWidth - margin - w, Math.max(margin, x));
    const ny = Math.min(window.innerHeight - margin - h, Math.max(margin, y));
    return {x:nx, y:ny};
  }

  target.addEventListener('pointerdown', (ev)=>{
    // 只允许左键 / 触摸
    if (ev.button !== undefined && ev.button !== 0) return;
    dragging=true;
    try{ target.setPointerCapture(ev.pointerId); }catch{}
    const r = box.getBoundingClientRect();
    sx = ev.clientX - r.left;
    sy = ev.clientY - r.top;
    document.body.style.userSelect='none';
  });

  target.addEventListener('pointermove', (ev)=>{
    if(!dragging) return;
    const r = box.getBoundingClientRect();
    const {x,y} = clamp(ev.clientX - sx, ev.clientY - sy, r.width, r.height);
    box.style.left = x + 'px';
    box.style.top = y + 'px';
  });

  function finish(ev){
    if(!dragging) return;
    dragging=false;
    try{ target.releasePointerCapture(ev.pointerId); }catch{}
    document.body.style.userSelect='';
    try{
      const r = box.getBoundingClientRect();
      localStorage.setItem(LSKEY+':barPos', JSON.stringify({x:Math.round(r.left), y:Math.round(r.top)}));
    }catch{}
  }
  target.addEventListener('pointerup', finish);
  target.addEventListener('pointercancel', finish);
}

function mountBar(){
  if(document.getElementById('pxeMiniBar')) return;
  const m=CFG.ui.margin; const pos=LS.get('barPos',{x:CFG.ui.x,y:CFG.ui.y});
  const bar=document.createElement('div'); bar.id='pxeMiniBar'; document.body.appendChild(bar);

  const colW=32, gapX=10, pad=10, cols=3;
  const fixedW = cols*colW + (cols-1)*gapX + pad*2;

  if(isCollapsed()){
    Object.assign(bar.style,{
      position:'fixed', zIndex:2147483647, left:pos.x+'px', top:pos.y+'px',
      width:'40px', height:'40px', borderRadius:'999px', background:'#409eff',
      display:'flex', alignItems:'center', justifyContent:'center',
      color:'#fff', fontWeight:'700', fontSize:'16px',
      boxShadow:'0 6px 22px rgba(0,0,0,.12)', userSelect:'none', cursor:'grab'
     });
    bar.style.background = (CFG.mode==='disk' ? COLOR.disk : COLOR.eagle);
    bar.textContent = (CFG.mode==='disk' ? 'D' : 'E');
    bar.title='展开 (单击) / 拖动 (移动位置)';
    enableCollapsedDragOrClick(bar, m);
    return;
  }

  Object.assign(bar.style,{
    position:'fixed', zIndex:2147483647, left:pos.x+'px', top:pos.y+'px',
    background:'rgba(255,255,255,0.96)', border:'1px solid rgba(0,0,0,.08)', borderRadius:'12px',
    boxShadow:'0 6px 22px rgba(0,0,0,.12)', boxSizing:'border-box',
    padding:`8px ${pad}px`, overflow:'hidden', userSelect:'none',
    width: fixedW+'px', maxWidth:`calc(100vw - ${m*2}px)`
  });

  // 顶部：标题(蓝色粗体 PTE) + 绿灯 + 时钟 + 缩小
  const topRow=document.createElement('div');
  Object.assign(topRow.style,{display:'flex',alignItems:'center',gap:'8px',marginBottom:'6px'});
  const leftGroup=document.createElement('div'); Object.assign(leftGroup.style,{display:'flex',alignItems:'center',gap:'6px'});
  const title=document.createElement('div'); title.textContent='PTE';
  title.style.cssText='font-size:12px;cursor:move;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700;color:#1f6fff;';
  const led=document.createElement('button'); led.textContent='●'; led.title='检查 Eagle (点击重载工具条)'; led.style.cssText='border:none;background:transparent;padding:0;cursor:pointer;line-height:1;color:#10b981;font-size:12px;';
  led.onclick=()=>{ const r=bar.getBoundingClientRect(); LS.set('barPos',{x:r.left,y:r.top}); bar.remove(); setTimeout(mountBar,0); };
  checkEagleLed(led);



  // 顶部模式指示：显示 'E' 或 'D'，仅用字体颜色区分；点击可切换
  const modeMark=document.createElement('button'); modeMark.setAttribute('data-pxe-mode-mark','1');
  function updateModeMark(){
    const disk = (CFG.mode==='disk');
    modeMark.textContent = disk ? 'D' : 'E';
    modeMark.title = disk ? '本地模式（点击切换）' : 'Eagle 模式（点击切换）';
    modeMark.style.cssText = 'border:none;background:transparent;padding:0 2px;height:18px;'
      + 'font-size:12px;font-weight:700;cursor:pointer;line-height:18px;'
      + 'color:' + (disk ? COLOR.disk : COLOR.eagle) + ';';
  }
  updateModeMark();
  modeMark.onclick = ()=>{ CFG.mode = (CFG.mode==='disk' ? 'eagle' : 'disk'); try{ LS.set('mode', CFG.mode); }catch{} updateModeMark(); render(); };

  // 顶部时钟（仅在开启时显示；点击即可关闭并消失）
  const topClockBox = document.createElement('span');
  function updateTopClock(){
    const on = !!CFG.feature.useUploadAsAddDate;
    if(on){
      topClockBox.style.display = 'inline-block';
      topClockBox.textContent = '🕒';
      topClockBox.title = '投稿时间→添加日期：已启用（点击关闭）';
      topClockBox.style.cssText = 'cursor:pointer;font-size:12px;line-height:1;';
      topClockBox.onclick = ()=>{
        CFG.feature.useUploadAsAddDate = false;
        try{ LS.set('useUploadAsAddDate', false); }catch{}
        updateTopClock();
        try { render && render(); } catch(e) {}
      };
    }else{
      topClockBox.style.display = 'none';
      topClockBox.textContent = '';
      topClockBox.removeAttribute('title');
      topClockBox.onclick = null;
    }
  }
  updateTopClock();
  // 监听 LS.set，以便在第二页切换时同步顶部图标
  try{
    const _LSset = LS.set.bind(LS);
    LS.set = (k,v)=>{ _LSset(k,v); if(k==='useUploadAsAddDate'){ try{ updateTopClock(); }catch(e){} } };
  }catch{}
     const shrink=document.createElement('button'); shrink.textContent='➖'; shrink.title='缩小';
  shrink.style.cssText='margin-left:auto;padding:0 4px;height:20px;border:none;background:transparent;color:#6b7280;border-radius:4px;cursor:pointer;font-size:16px;';
  shrink.onclick=()=>{
    const sr=shrink.getBoundingClientRect();
    const size=40; const m=CFG.ui.margin;
    let x = sr.right - size; let y = sr.top - Math.max(0,(size - sr.height)/2);
    x = Math.min(window.innerWidth - m - size, Math.max(m, x));
    y = Math.min(window.innerHeight - m - size, Math.max(m, y));
    try{ localStorage.setItem(LSKEY+':anchor', JSON.stringify({x:x+size/2, y:y+size/2})); }catch{}
    setCollapsed(true, {x: Math.floor(x), y: Math.floor(y)});
  };
  leftGroup.append(title, led, topClockBox, modeMark);
  topRow.append(leftGroup, shrink);
  bar.appendChild(topRow);
  // 用 anchor(小圆点中心) 来精确对齐缩小按钮：
  // 计算缩小按钮相对整个面板的中心偏移，然后把面板左上角设置为 anchor - 偏移
  try{
    const anchorRaw = localStorage.getItem(LSKEY+':anchor');
    if (anchorRaw) {
      const anchor = JSON.parse(anchorRaw);
      const br = bar.getBoundingClientRect();
      const sr = shrink.getBoundingClientRect();
      const relX = (sr.left - br.left) + sr.width/2;
      const relY = (sr.top - br.top ) + sr.height/2;
      let nx = Math.round(anchor.x - relX);
      let ny = Math.round(anchor.y - relY);
      const m = CFG.ui.margin;
      const vw = window.innerWidth, vh = window.innerHeight;
      // 夹取，保证面板完整可见
      nx = Math.max(m, Math.min(vw - m - br.width, nx));
      ny = Math.max(m, Math.min(vh - m - br.height, ny));
      bar.style.left = nx + 'px';
      bar.style.top = ny + 'px';
      try{ localStorage.setItem(LSKEY+':barPos', JSON.stringify({x:nx, y:ny})); }catch{}
      try{ localStorage.removeItem(LSKEY+':anchor'); }catch{}
    }
  }catch{}
// 网格按钮
  const grid=document.createElement('div');
  Object.assign(grid.style,{ display:'grid', gridTemplateColumns: 'repeat(3, 32px)', justifyContent:'start', justifyItems:'center', gap:'6px 10px', alignItems:'center' });
  bar.appendChild(grid);
  grid.style.gridAutoRows='28px';


// 统一按钮尺寸 & 顶部模式同步
const BTN = 40; // 与第一页一致（如需调整，改这里即可）
function syncModeMark(){
  const el = document.querySelector('[data-pxe-mode-mark="1"]');
  if(!el) return;
  const disk = (CFG.mode==='disk');
  el.textContent = disk ? 'D' : 'E';
  el.title = disk ? '本地模式（点击切换）' : 'Eagle 模式（点击切换）';
  el.style.color = disk ? COLOR.disk : COLOR.eagle;
}


  function iconBtn(emoji, tip, onClick, opts={}){
    const b=document.createElement('button'); b.textContent=emoji; b.title=tip;
    const bg = opts.bg || '#409eff';
    b.style.cssText=`width:32px;height:28px;margin:0;box-sizing:border-box;padding:0;border:none;background:${bg};border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,.06);cursor:pointer;font-size:16px;line-height:28px;text-align:center;text-align:center;text-align:center;text-align:center;text-align:center;`;
    b.onclick=onClick; return b;
  }
  function spacer(){ const b=document.createElement('button'); b.title=''; b.disabled=true; b.style.cssText=`width:${BTN}px;height:${BTN}px;padding:0;border:none;background:transparent;border-radius:8px;opacity:0;pointer-events:none;`; return b; }
  function invertSelection(){ document.querySelectorAll('.pxe-mini-checkbox').forEach(cb=>{ cb.checked = !cb.checked; }); }

  const onArtwork = isArtwork();
  const onUserPage = isUser();
  const state={page:1};

  let render = ()=>{};
  render = ()=>{
    grid.innerHTML='';
    if(state.page===1){
      if(onUserPage){
        grid.append(
          iconBtn('🌐','作者全部',()=>importMode('all')),
          iconBtn('📄','本页',()=>importMode('page')),
          iconBtn('✅','仅勾选',()=>importMode('selected')),
          iconBtn('☑️','全选',()=>{ document.querySelectorAll('.pxe-mini-checkbox').forEach(cb=>{ cb.checked = true; }); }),
          iconBtn('◻️','全不选',()=>{ document.querySelectorAll('.pxe-mini-checkbox').forEach(cb=>{ cb.checked = false; }); }),
          iconBtn('➡️','下一页',()=>{ state.page=2; render(); })
        );
      }else if(onArtwork){
        // 详情页：六键布局，顺序：此作 | 本页 | 仅勾选 | 全选 | 全不选 | 下一页
        grid.append(
          iconBtn('🎯','此作',()=>importMode('one')),
          iconBtn('📄','本页',()=>importMode('page')),
          iconBtn('✅','仅勾选',()=>importMode('selected')),
          iconBtn('☑️','全选',()=>{ document.querySelectorAll('.pxe-mini-checkbox').forEach(cb=>{ cb.checked = true; }); }),
          iconBtn('◻️','全不选',()=>{ document.querySelectorAll('.pxe-mini-checkbox').forEach(cb=>{ cb.checked = false; }); }),
          iconBtn('➡️','下一页',()=>{ state.page=2; render(); })
        );
      }else{
        grid.append(
          iconBtn('🌐','本页全部', ()=>importMode('page')),
          iconBtn('📄','本页',()=>importMode('page')),
          iconBtn('✅','仅勾选',()=>importMode('selected')),
          iconBtn('☑️','全选',()=>{ document.querySelectorAll('.pxe-mini-checkbox').forEach(cb=>{ cb.checked = true; }); }),
          iconBtn('◻️','全不选',()=>{ document.querySelectorAll('.pxe-mini-checkbox').forEach(cb=>{ cb.checked = false; }); }),
          iconBtn('➡️','下一页',()=>{ state.page=2; render(); })
        );
      }
    } else {
      // 第二页：反选 + 投稿时间开关 + 模式切换(E/D) + 上一页
      const btnInvert = iconBtn('🔁','反选',invertSelection);
      const on = !!CFG.feature.useUploadAsAddDate;
      const btnTime = iconBtn('🕒', on ? '投稿时间→添加日期（已启用）' : '投稿时间→添加日期（点击启用）', ()=>{
        CFG.feature.useUploadAsAddDate = !CFG.feature.useUploadAsAddDate;
        LS.set('useUploadAsAddDate', CFG.feature.useUploadAsAddDate);
        render();
      }, { bg: on ? '#10b981' : '#409eff' });
      const btnMode = iconBtn((CFG.mode==='disk'?'D':'E'),
  (CFG.mode==='disk'?'本地模式（点击切换）':'Eagle 模式（点击切换）'),
  ()=>{ CFG.mode = (CFG.mode==='disk'?'eagle':'disk'); LS.set('mode', CFG.mode); try{ syncModeMark(); }catch{} render(); },
  { bg: (CFG.mode==='disk'? COLOR.disk : COLOR.eagle) }
);
const btnPick = iconBtn('📁','选择下载目录', async ()=>{ await ptePickDownloadsRoot(); }, { bg:'#f1a72e' });
// 右下角“上一页”
const btnBack = iconBtn('⬅️','上一页',()=>{ state.page=1; render(); });
// 尝试在多种布局下靠右下角：
; grid.append(btnInvert, btnTime, btnMode, btnPick, spacer(), btnBack);
    }
  };
  render();

  enableDrag(bar, m, title);
}

watch();
setTimeout(mountBar,0);

})();


/* === PTE Welcome Modal (auto-insert) === */
(function(){
  try{
    // Prefer TM/GM provided version, fallback to metadata, then default
    var PTE_VER = (typeof GM_info!=='undefined' && GM_info && GM_info.script && GM_info.script.version) ? GM_info.script.version : '';
    if(!PTE_VER){
      try{
        var meta = document.currentScript && document.currentScript.text || '';
        var m = /@version\s+([0-9][^\r\n]*)/i.exec(meta);
        if(m) PTE_VER = (m[1]||'').trim();
      }catch(e){}
    }
    if(!PTE_VER){ PTE_VER = '0.9.8.3'; }

    // Hardcoded update date for display (YYYY-MM-DD)
    var PTE_UPDATED_DATE = '2025-10-19';

    // Use existing LS helper if available; otherwise namespaced localStorage shim
    var _LS = (typeof LS!=='undefined' && LS && typeof LS.get==='function')
      ? LS
      : {
          get: function(k, d){
            try{
              var v = localStorage.getItem('pxeMini:'+k);
              return v!==null ? JSON.parse(v) : d;
            }catch(e){ return d; }
          },
          set: function(k, v){
            try{
              localStorage.setItem('pxeMini:'+k, JSON.stringify(v));
            }catch(e){}
          }
        };

    function fmtTime(ts){
      try{
        return new Date(ts).toLocaleString('zh-CN', {hour12:false});
      }catch(e){
        return ''+ts;
      }
    }

    function createWelcomeModal(updatedAtTs){
      if (document.getElementById('pteWelcome')) return;
      var mask = document.createElement('div');
      mask.id = 'pteWelcome';
      Object.assign(mask.style, {
        position:'fixed', inset:'0',
        background:'rgba(0,0,0,.35)',
        backdropFilter:'blur(2px)',
        zIndex:2147483647,
        display:'flex', alignItems:'center', justifyContent:'center'
      });
      var box = document.createElement('div');
      Object.assign(box.style, {
        width:'min(560px,92vw)',
        borderRadius:'16px',
        background:'#fff',
        boxShadow:'0 12px 40px rgba(0,0,0,.18)',
        padding:'16px 18px',
        fontSize:'13px',
        color:'#444',
        lineHeight:'1.6',
        maxHeight:'80vh', overflow:'auto'
      });
      var timeStr = PTE_UPDATED_DATE;
      box.innerHTML = ''
      + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">'
      +   '<div style="font-size:18px;font-weight:700;color:#1f6fff;">PTE 已更新 ✅</div>'
      +   '<span style="margin-left:auto;color:#999;font-size:12px">v'+ PTE_VER +'</span>'
      + '</div>'
      + '<div style="color:#999;font-size:12px;margin-bottom:8px;">更新时间：'+ timeStr +' ｜ 版本号：v'+ PTE_VER +'</div>'
      + '<div>'
      +   '<p>右上角工具条：<b style="color:#409eff">E（蓝）</b> = Eagle 模式，<b style="color:#f1a72e">D（橙）</b> = 本地模式。</p>'
      +   '<p>详情页六键：<code>此作</code> / <code>本页</code> / <code>仅勾选</code> / <code>全选</code> / <code>全不选</code> / <code>下一页</code>。</p>'
      +   '<p>第二页：🔁 反选 · 🕒 投稿时间→添加日期 · 📁 选择下载目录 · E/D 切换。</p>'
      +   '<p style="color:#666">小技巧：点击绿灯检查 Eagle；点“➖”可缩小为悬浮圆点。</p>'
      +   '<p style="margin-top:6px"><b>没看到弹窗/工具条？</b> 如果脚本已启动但首次没看到，UI 可能在浏览器窗口右侧；请尝试将浏览器窗口<b>拉宽</b>即可看见。</p>'
      +   '<p><b>连续多选：</b> 在列表/缩略图页，先点击左侧的勾选框选中一项，然后按住 <kbd>Shift</kbd> 再点击另一项，<b>两者之间的范围</b>会被一次性选中。</p>'
      + '</div>'
      + '<div style="display:flex;gap:10px;margin-top:14px;justify-content:flex-end;">'
      +   '<button id="pxeWelcomeOk" style="padding:6px 14px;border:none;border-radius:8px;background:#409eff;color:#fff;cursor:pointer;font-weight:600">我知道了</button>'
      + '</div>';
      mask.appendChild(box);
      document.body.appendChild(mask);
      mask.addEventListener('click', function(e){ if(e.target===mask) mask.remove(); });
      var ok = box.querySelector('#pxeWelcomeOk');
      if (ok) ok.addEventListener('click', function(){ mask.remove(); });
    }

    function showWelcomePerVersion(){
      var lastVer = _LS.get('welcomeVer', '');
      if (lastVer !== PTE_VER){
        // Record update time "now" for display; also set version to current
        var now = Date.now();
        _LS.set('welcomeAt', now);
        _LS.set('welcomeVer', PTE_VER);
        // Show after DOM ready
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function(){ setTimeout(function(){ createWelcomeModal(now); }, 200); }, {once:true});
        } else {
          setTimeout(function(){ createWelcomeModal(now); }, 200);
        }
      }
    }

    // Schedule after the script's own UI mounts; using a slight delay avoids racing existing layout code
    setTimeout(showWelcomePerVersion, 600);
  }catch(e){ /* silent */ }
})();
/* === /PTE Welcome Modal (auto-insert) === */

