'use strict';
const {Plugin, Modal, Notice, TFile, normalizePath, requestUrl} = require('obsidian');
const {scan, safeName, imageType, replaceSources, stamp, numberFigures, imageAtCursor, matchesImageStem, stripReferenceStamp, referenceUpdate, validateMarkdownMath, figureId, referencePath, candidatePaths, canonicalizeLinks} = require('./core');
const crypto = require('crypto');
function now() { const d = new Date(), p = n => String(n).padStart(2,'0'); return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
function hash(b) { return crypto.createHash('sha256').update(Buffer.from(b)).digest('hex'); }
function versionTime() { const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3,'0')}`; }
class ReplaceImage extends Modal {
  constructor(plugin,file,original,row) {super(plugin.app);Object.assign(this,{plugin,file,original,row});}
  onOpen() {
    this.modalEl.style.width='min(700px,90vw)';this.modalEl.style.minWidth='0';
    const el=this.contentEl;el.createEl('h2',{text:'替换当前图片'});
    el.createEl('p',{text:`${this.row.filename}：图片文件名不加时间戳，新图使用 {#fig:时间戳} 标签，换图保留已有标签。替换同名图片，旧内容保存到历史版本，保留图题、标签和宽度。`});
    el.createEl('p',{text:'选择电脑上的新图片，或填写新图片网址。'});
    const local=el.createEl('input',{type:'file'});local.accept='.png,.jpg,.jpeg,.svg,.gif,.webp,.bmp,.avif,.tif,.tiff';
    const url=el.createEl('input',{type:'url',placeholder:'https://…'});url.style.width='100%';
    const status=el.createEl('p');
    const button=el.createEl('button',{text:'保存新版本并替换引用'});
    button.onclick=async()=>{
      button.disabled=true;
      try {
        if(local.files?.length && url.value.trim())throw new Error('请选择本地图片或网址其中一种');
        const options={onlyStart:this.row.start,force:true};
        if(this.row.captionSource==='手动图名')options.captionOverrides={[this.row.start]:this.row.title};
        if(local.files?.length)options.data=await local.files[0].arrayBuffer();
        else {const address=url.value.trim();if(!/^https?:\/\//i.test(address))throw new Error('请选择图片或填写 http/https 图片网址');options.url=address;}
        const log=await this.plugin.collect(this.file,this.original,scan(this.original),options);
        if(log.images.some(x=>x.status==='失败'))throw new Error(log.images.find(x=>x.status==='失败').reason);
        this.close();new Result(this.app,log,this.plugin).open();
      }catch(e){status.textContent=e.message;button.disabled=false;}
    };
  }
  onClose(){this.contentEl.empty();}
}
class Preview extends Modal {
  constructor(plugin,file,text,rows,plan) { super(plugin.app); Object.assign(this,{plugin,file,text,rows,plan});this.selected=new Set();this.overrides={}; }
  onOpen() {
    this.modalEl.style.width='min(800px, 90vw)'; this.modalEl.style.minWidth='0';
    const el = this.contentEl; el.empty(); el.createEl('h2',{text:'归集当前文章图片'});
    const label=el.createEl('label',{text:'文件名图号：'}),select=label.createEl('select');
    for(const [value,text]of [['auto','自动（按文章 chapters 属性）'],['chapter','按章节：图2-1_图名'],['sequential','全文连续：图1_图名']])select.createEl('option',{value,text});
    select.value=this.plugin.settings?.numbering||'auto';
    select.onchange=async()=>{
      this.plugin.settings.numbering=select.value;await this.plugin.saveData(this.plugin.settings);
      this.rows=this.plugin.articleRows(this.text,this.file,this.overrides);
      this.plan=await Promise.all(this.rows.map(row=>this.plugin.inspect(row,this.file,this.text)));this.onOpen();
    };
    el.createEl('p',{text:'图片文件夹与文章同级，命名为“（图件）完整文章名”；保留原图片，保存快照，成功后更新引用。'});
    const pending=this.rows.filter((row,i)=>this.plan[i].action!=='skip');
    el.createEl('p',{text:`识别 ${this.rows.length} 处图片引用：待处理 ${pending.length} 张，已归集 ${this.rows.length-pending.length} 张将直接跳过。`});
    el.createEl('p',{text:'保存为“图号_论文图题”，新图添加 {#fig:时间戳} 标签，已有标签保持不变。'});
    el.createEl('p',{text:`目标文件夹：${this.plugin.folder(this.file)}`});
    const summary=el.createEl('p'),checks=[];
    const refresh=()=>{summary.textContent=`已选 ${this.selected.size} / ${this.rows.length} 张；未勾选图片不处理。`;button.disabled=!this.selected.size;};
    el.createEl('button',{text:'全选待处理'}).onclick=()=>{checks.forEach(x=>{x.check.checked=x.plan.action!=='skip';if(x.check.checked)this.selected.add(x.row.start);else this.selected.delete(x.row.start);});refresh();};
    el.createEl('button',{text:'取消全选'}).onclick=()=>{this.selected.clear();checks.forEach(x=>x.check.checked=false);refresh();};
    const list = el.createEl('div'); list.style.maxHeight = '50vh'; list.style.overflow = 'auto';
    this.rows.forEach((row,i)=>{
      const plan=this.plan[i],item=list.createEl('div');item.style.cssText='margin:12px 0;padding:10px;border:1px solid var(--background-modifier-border);overflow-wrap:anywhere';
      const label=item.createEl('label'),check=label.createEl('input',{type:'checkbox'});
      if(!this.initialized&&plan.action!=='skip'&&!row.needsCaptionReview)this.selected.add(row.start);
      check.checked=this.selected.has(row.start);label.createEl('strong',{text:` ${row.filename}`});
      check.onchange=()=>{if(check.checked)this.selected.add(row.start);else this.selected.delete(row.start);refresh();};checks.push({check,row,plan});
      const display=item.createEl('p',{text:`原文件：${plan.local?.path||row.src} → ${plan.destination||this.plugin.folder(this.file)+'/'+row.filename+'.扩展名自动识别'}`});display.style.fontSize='0.85em';
      item.createEl('p',{text:`${row.chapter?'第 '+row.chapter+' 章':row.numbering==='sequential'?'全文连续编号':'未识别章节'} · 图题来源：${row.captionSource} · ${plan.reason}`});
      if(row.warning)item.createEl('p',{text:row.warning});
      if(row.needsCaptionReview)item.createEl('p',{text:'请确认图名后勾选；相邻多图不会自动共用同一图注。'});
      const input=item.createEl('input',{type:'text',value:row.title});input.style.width='100%';input.setAttribute('aria-label','保存图片的图名');
      input.onchange=async()=>{this.overrides[row.start]=input.value.trim();this.rows=this.plugin.articleRows(this.text,this.file,this.overrides);this.plan=await Promise.all(this.rows.map(r=>this.plugin.inspect(r,this.file,this.text)));this.onOpen();};
      if(plan.action==='missing') {
        item.createEl('button',{text:'重新选择图片或网址'}).onclick=()=>new ReplaceImage(this.plugin,this.file,this.text,row).open();
        if(plan.recovery)item.createEl('button',{text:plan.recovery.kind==='trash'?'从库内回收站恢复':plan.recovery.kind==='local'?'确认使用找到的库内图片':'从归集记录重新获取'}).onclick=async()=>{
          try{const options={onlyStart:row.start,force:true};if(row.captionSource==='手动图名')options.captionOverrides={[row.start]:row.title};
            if(plan.recovery.path)options.data=await this.plugin.app.vault.adapter.readBinary(plan.recovery.path);else options.url=plan.recovery.url;
            if(plan.recovery.sha256&&hash(options.data)!==plan.recovery.sha256)throw new Error('回收站图片与归集记录不一致，请手动选择图片');
            const log=await this.plugin.collect(this.file,this.text,[row],options);this.close();new Result(this.app,log,this.plugin).open();
          }catch(e){new Notice(e.message,8000);}
        };
      }
    });this.initialized=true;
    if(!pending.length)el.createEl('p',{text:'所有图片已归集，当前没有需要更新的图片。'});
    const button = el.createEl('button',{text:'处理勾选图片'});refresh();
    button.onclick = async () => { button.disabled = true; button.textContent = '正在处理，请稍候…'; try { const report = await this.plugin.collect(this.file,this.text,this.rows.filter(r=>this.selected.has(r.start)),{captionOverrides:this.overrides}); this.close(); new Result(this.app,report,this.plugin).open(); } catch(e) { el.createEl('p',{text:e.message}); button.textContent = '重新尝试';refresh(); } };
  }
  onClose() { this.contentEl.empty(); }
}
class Result extends Modal {
  constructor(app,report,plugin) { super(app); this.report=report;this.plugin=plugin; }
  onOpen() {
    this.modalEl.style.width='min(700px, 90vw)'; this.modalEl.style.minWidth='0';
    this.contentEl.createEl('h2',{text:'图片归集结果'});
    this.contentEl.createEl('p',{text:`更新 ${this.report.images.filter(x=>x.status==='成功').length} 张，跳过 ${this.report.images.filter(x=>x.status==='跳过').length} 张，失败 ${this.report.images.filter(x=>x.status==='失败').length} 张。`});
    this.contentEl.createEl('p',{text:`文件夹：${this.report.folder}`});
    for (const row of this.report.images.filter(x=>x.status==='失败')) this.contentEl.createEl('p',{text:`${row.source}：${row.reason}`});
    if(this.plugin&&this.report.images.some(x=>x.status==='失败'))this.contentEl.createEl('button',{text:'返回预览：恢复或重新选择来源'}).onclick=()=>{this.close();this.plugin.preview(this.app.vault.getAbstractFileByPath(this.report.article));};
    this.contentEl.createEl('p',{text:'可在命令面板运行“文章图片归集：恢复最近一次归集前的文章”。恢复前会检查文章是否已有其他修改。'});
    this.contentEl.createEl('button',{text:'完成'}).onclick=()=>this.close();
  }
  onClose() { this.contentEl.empty(); }
}
module.exports = class Collector extends Plugin {
  async onload() {
    this.running = false;
    this.settings=Object.assign({numbering:'auto',captions:{}},await this.loadData());
    this.addCommand({id:'collect-current-article-images',name:'归集当前文章图片',callback:() => this.preview(this.app.workspace.getActiveFile())});
    this.addCommand({id:'restore-current-article-images',name:'恢复最近一次归集前的文章',callback:() => this.restore(this.app.workspace.getActiveFile())});
    this.addCommand({id:'replace-current-image',name:'替换光标所在图片（保留图题和编号）',editorCallback:(editor,view)=>this.replaceAtEditor(editor,view.file)});
    this.registerEvent(this.app.workspace.on('editor-menu',(menu,editor,view)=>{
      if(imageAtCursor(editor.getValue(),editor.posToOffset(editor.getCursor())))menu.addItem(item=>item.setTitle('替换当前图片（保留图题和编号）').setIcon('image').onClick(()=>this.replaceAtEditor(editor,view.file)));
    }));
    this.registerEvent(this.app.workspace.on('file-menu',(menu,file) => { if (file instanceof TFile && file.extension === 'md') menu.addItem(item => item.setTitle('归集当前文章图片').setIcon('image').onClick(() => this.preview(file))); }));
  }
  folder(file) { return normalizePath(`${file.parent.path === '/' ? '' : file.parent.path + '/'}（图件）${file.basename}`); }
  async replaceAtEditor(editor,file) {
    try {
      if(!(file instanceof TFile))throw new Error('请先打开文章');
      const original=editor.getValue(),raw=imageAtCursor(original,editor.posToOffset(editor.getCursor()));
      if(!raw)throw new Error('请把光标放在要替换的图片引用所在行；同一行有多图时放在对应图片语法内');
      if(await this.app.vault.read(file)!==original)throw new Error('文章正在保存，请稍后重试');
      const row=this.articleRows(original,file).find(x=>x.start===raw.start);
      new ReplaceImage(this,file,original,row).open();
    }catch(e){new Notice(e.message,8000);}
  }
  async preview(file) {
    if (!file || file.extension !== 'md') return new Notice('请先打开 Markdown 文章');
    const text = await this.app.vault.read(file), rows = this.articleRows(text,file);
    if (!rows.length) return new Notice('没有识别到图片引用');
    const plan=await Promise.all(rows.map(row=>this.inspect(row,file,text)));
    new Preview(this,file,text,rows,plan).open();
  }
  resolve(src,file) {
    src=stripReferenceStamp(src);
    let decoded; try { decoded = decodeURIComponent(src); } catch { decoded = src; }
    for(const candidate of candidatePaths(src,file.path)){const direct=this.app.vault.getAbstractFileByPath(normalizePath(candidate));if(direct instanceof TFile)return direct;}
    return this.app.metadataCache.getFirstLinkpathDest(decoded,file.path);
  }
  captionKey(text,row,file) {return file.path+'::'+(figureId(text,row)||row.src);}
  articleRows(text,file,overrides={}) {
    const rows=scan(text).map(row=>{const key=this.captionKey(text,row,file),saved=this.settings?.captions?.[key];
      const title=overrides[row.start]!==undefined?overrides[row.start]:saved;
      return title!==undefined?{...row,title:title||'未命名图片',captionSource:'手动图名',needsCaptionReview:false}:row;});
    return numberFigures(text,rows,this.settings?.numbering||'auto');
  }
  async rememberCaptions(file,result,full,rows,report,overrides) {
    if(!overrides||!this.saveData)return;
    this.settings=this.settings||{numbering:'auto',captions:{}};this.settings.captions=this.settings.captions||{};
    const successful=new Set(report.filter(r=>r.status!=='失败').map(r=>r.source)),resultRows=scan(result);
    for(const row of rows)if(successful.has(row.src)&&overrides[row.start]!==undefined){
      const ordinal=full.findIndex(r=>r.start===row.start),resultRow=resultRows[ordinal];
      if(resultRow)this.settings.captions[this.captionKey(result,resultRow,file)]=row.title;
    }
    try{await this.saveData(this.settings);}catch(e){new Notice('图片已处理，但手动图名设置未保存：'+e.message,8000);}
  }
  async recovery(row,file) {
    const folder=this.folder(file);let record;
    try{const log=JSON.parse(await this.app.vault.adapter.read(folder+'/最近归集.json'));record=log.images.find(r=>candidatePaths(row.src,file.path).includes(r.destination));}catch{}
    for(const dest of candidatePaths(row.src,file.path)){
      const path='.trash/'+dest.split('/').slice(-2).join('/');
      if(await this.app.vault.adapter.exists(path))return {kind:'trash',path,sha256:record?.sha256};
    }
    const url=record?.replacementSource||record?.source;
    return /^https?:\/\//i.test(url||'')?{kind:'source',url}:null;
  }
  async inspect(row,file,text) {
    if(/^https?:\/\//i.test(row.src))return {action:'download',reason:'网络图片：下载归集'};
    const local=this.resolve(row.src,file),folder=this.folder(file);
    if(!(local instanceof TFile)||!(await this.app.vault.adapter.exists(local.path))){
      const recovery=await this.recovery(row,file),name=candidatePaths(row.src,file.path)[0]?.split('/').pop();
      const matches=(this.app.vault.getFiles?.()||[]).filter(f=>f.name===name);
      if(!recovery&&matches.length===1)return {action:'missing',reason:'原路径无效；发现同名库内图片，请确认后使用：'+matches[0].path,recovery:{kind:'local',path:matches[0].path}};
      return {action:'missing',reason:recovery?.kind==='trash'?'图片已移入库内回收站，可恢复':recovery?.kind==='source'?'本地图片已缺失，可按原网络来源重新获取':'本地图片缺失或路径无效；可重新选择来源'+(row.src.startsWith('.')?'（已尝试按文章目录解析相对路径）':''),recovery};
    }
    const destination=folder+'/'+row.filename+'.'+local.extension;
    if(local.path.slice(0,local.path.lastIndexOf('/'))===folder){
      const stem=local.basename,matching=matchesImageStem(stem,row.filename);
      if(matching)return {action:referenceUpdate(text,row,undefined,new Set())?'metadata':'skip',local,destination:local.path,reason:'图片已归集；'+(referenceUpdate(text,row,undefined,new Set())?'仅更新引用标签':'无需处理')};
      return {action:'rename',local,destination,reason:'图号或图名变化：只改名，保留图片内容'};
    }
    return {action:'copy',local,destination,reason:'库内其他目录图片：复制归集，保留来源'};
  }
  async managed(row,file) {
    if(/^https?:\/\//i.test(row.src))return null;
    const local=this.resolve(row.src,file);
    if(!(local instanceof TFile))return null;
    const folder=this.folder(file),slash=local.path.lastIndexOf('/');
    if(local.path.slice(0,slash)!==folder)return null;
    const name=local.path.slice(slash+1),stem=name.replace(/\.[^.]+$/,''),base=row.filename||safeName(row.title);
    if(!matchesImageStem(stem,base))return null;
    if(!(await this.app.vault.adapter.exists(local.path)))return null;
    return {source:row.src,destination:local.path,status:'跳过',reason:'已在文章图片文件夹，图号和图题未变'};
  }
  async mkdir(path) { if (!(await this.app.vault.adapter.exists(path))) await this.app.vault.createFolder(path); }
  async collectFile(file) {
    if (!(file instanceof TFile) || file.extension !== 'md') throw new Error('请选择 Markdown 文章');
    const text = await this.app.vault.read(file);
    return this.collect(file,text,scan(text));
  }
  async validate(text) {
    if (/[\u2070-\u209f]/.test(text)) throw new Error('笔记含 Unicode 假上下标，请先修正；正文未修改');
    const issues=validateMarkdownMath(text);
    if(issues.length)throw new Error('数学格式校验未通过，正文未修改：'+issues.map(x=>`第 ${x.line} 行 [${x.code}] ${x.message}`).join('；'));
  }
  async collect(file,original,rows,options={}) {
    if (this.running) throw new Error('已有归集任务正在运行');
    if (await this.app.vault.read(file) !== original) throw new Error('文章已变化，请重新预览');
    this.running = true;
    try {
      const full=this.articleRows(original,file,options.captionOverrides);
      const wanted=new Set(rows.map(row=>row.start));
      rows=full.filter(row=>wanted.has(row.start) && (options.onlyStart===undefined||row.start===options.onlyStart));
      if(options.onlyStart!==undefined&&!rows.length)throw new Error('找不到所选图片，请重新选择');
      const folder = this.folder(file);
      const report = []; const changed = [],overwrites=[],renames=[];
      const used=new Set([...original.matchAll(/#fig:([^\s}]+)/g)].map(m=>m[1]));
      for (const row of rows) {
        try {
          const plan=options.force?null:await this.inspect(row,file,original);
          if(plan?.action==='rename'){
            if(full.filter(r=>this.resolve(r.src,file)?.path===plan.local.path).length>1)throw new Error('这张图片在文章中重复引用，请先为不同图号选择独立图片，避免改名后引用混淆');
            if(renames.some(r=>r.from===plan.local.path))throw new Error('同一图片被多处引用且命名不同，请单独处理并确认图题');
            const move={from:plan.local.path,to:plan.destination,start:row.start};renames.push(move);
            const update=referenceUpdate(original,row,referencePath(original,row,move.to),used);if(update)changed.push(update);
            report.push({source:row.src,destination:move.to,renamedFrom:move.from,status:'成功',reason:'仅改名，图片内容不重新保存'});continue;
          }
          const existing=options.force?null:await this.managed(row,file);
          if(existing){const update=referenceUpdate(original,row,undefined,used);if(update)changed.push(update);report.push(update?{...existing,status:'成功',reason:'仅更新引用标签，图片未重新保存'}:existing);continue;}
          let data;const source=options.url||row.src;
          if(options.data!==undefined)data=options.data;
          else if (/^https?:\/\//i.test(source)) {let res;try{res=await requestUrl({url:source,throw:false});}catch(e){throw new Error('网络请求失败，请检查网络或换用可访问的图片直链：'+e.message);}if (res.status < 200 || res.status >= 300) throw new Error(`下载失败 HTTP ${res.status}：${res.status===404?'图片地址不存在':res.status===401||res.status===403?'来源需要登录或拒绝下载':'请稍后重试或重新选择来源'}`); data = res.arrayBuffer; }
          else { const local = this.resolve(row.src,file); if (!(local instanceof TFile)) throw new Error(plan?.reason||'本地图片缺失或路径无效，请在预览中恢复或重新选择来源'); data = await this.app.vault.readBinary(local); }
          const ext = imageType(data), digest = hash(data), base = row.filename||safeName(row.title);
          await this.mkdir(folder);
          const savedAt=versionTime();
          const dest = normalizePath(`${folder}/${base}.${ext}`);
          if(renames.some(r=>r.from===dest||r.to===dest))throw new Error('目标与其他图片的改名操作冲突，请分批处理');
          let history;
          if(await this.app.vault.adapter.exists(dest)) {
            const oldData=await this.app.vault.adapter.readBinary(dest),previousSha256=hash(oldData);
            if(previousSha256!==digest) {
              if(overwrites.some(x=>x.destination===dest))throw new Error('同一图号文件存在多个不同图片来源，请检查');
              history={backupImage:`${folder}/历史版本/${previousSha256}.${ext}`,previousSha256};
              overwrites.push({destination:dest,data,oldData,sha256:digest,...history});
            }
          } else await this.app.vault.createBinary(dest,data);
          if(!history && hash(await this.app.vault.adapter.readBinary(dest))!==digest)throw new Error('保存后校验失败');
          // Keep Chinese paths readable; encode only Markdown/URL delimiters.
          const target = dest.replace(/[% ()#?\[\]<>]/g,c=>'%' + c.charCodeAt(0).toString(16).toUpperCase());
          // Wiki embeds require a raw vault path; Markdown/Pandoc references retain their original syntax.
          const isWiki = original.slice(row.start-3,row.start) === '![[';
          const update=referenceUpdate(original,row,isWiki?dest:target,used);
          if(update)changed.push(update);
          report.push({source:row.src,replacementSource:options.url||(options.data!==undefined?'本地选择图片':undefined),destination:dest,savedAt,sha256:digest,...history,status:'成功'});
        } catch(e) { report.push({source:row.src,start:row.start,status:'失败',reason:e.message}); }
      }
      if (await this.app.vault.read(file) !== original) throw new Error('处理期间文章已变化。图片已保存，正文未替换，请重新预览');
      const time = now(), id = `${time.replace(/[^0-9]/g,'')}-${Date.now()}`;
      if(!changed.length&&!overwrites.length&&report.every(row=>row.status==='跳过')) {
        const log={article:file.path,folder,time,backup:null,resultHash:hash(Buffer.from(original)),images:report};
        await this.rememberCaptions(file,original,full,rows,report,options.captionOverrides);
        new Notice(`无需更新：${report.length} 张图片已归集，全部跳过。`,6000);
        return log;
      }
      // Validate the complete move plan before touching filenames. Temporary names allow swaps.
      const froms=new Set(renames.map(r=>r.from)),tos=new Set();
      for(const item of overwrites)if(renames.some(r=>r.from===item.destination||r.to===item.destination))throw new Error('图片替换与改名目标冲突，请分批处理');
      for(const move of renames){
        if(tos.has(move.to))throw new Error('多个图片将改为同一文件名，请确认图名');tos.add(move.to);
        if(await this.app.vault.adapter.exists(move.to)&&!froms.has(move.to))throw new Error('改名目标已存在，已停止以保护图片：'+move.to);
        move.temp=folder+'/.rename-'+crypto.randomBytes(8).toString('hex')+'.'+move.from.split('.').pop();
        if(await this.app.vault.adapter.exists(move.temp))throw new Error('临时改名目标已存在，请重试');
      }
      const needsBackup=changed.length||overwrites.length||renames.length;
      await this.mkdir(folder);
      const backup = `${folder}/归集前-${id}.snapshot`;let result = changed.length ? stamp(replaceSources(original,changed),time) : original;
      if (changed.length) await this.validate(result);
      if (needsBackup) await this.app.vault.adapter.write(backup,original);
      const log = {article:file.path,folder,time,backup:needsBackup?backup:null,resultHash:hash(Buffer.from(result)),images:report,renames};
      await this.mkdir(folder);
      await this.app.vault.adapter.write(`${folder}/归集记录-${id}.json`,JSON.stringify(log,null,2));
      const applied=[],moved=[];
      try {
        if(renames.length){
          if(await this.app.vault.read(file)!==original)throw new Error('文章已变化，停止改名');
          for(const move of renames){await this.app.fileManager.renameFile(this.app.vault.getAbstractFileByPath(move.from),move.temp);moved.push({...move,current:move.temp});}
          for(const move of moved){await this.app.fileManager.renameFile(this.app.vault.getAbstractFileByPath(move.current),move.to);move.current=move.to;}
          for(const move of renames){const stat=this.app.vault.getAbstractFileByPath(move.to)?.stat;if(stat)move.resultStat={mtime:stat.mtime,size:stat.size};}
          const updated=await this.app.vault.read(file);
          if(updated!==original&&canonicalizeLinks(updated,file.path,renames,true)!==canonicalizeLinks(original,file.path,renames))throw new Error('改名期间文章发生了其他修改');
          // Rebase selected image edits onto FileManager's link updates, keeping other links intact.
          const beforeRows=scan(original),afterRows=scan(updated),rebased=[],rebasedUsed=new Set([...updated.matchAll(/#fig:([^\s}]+)/g)].map(m=>m[1]));
          for(const edit of changed){const ordinal=beforeRows.findIndex(r=>r.start===edit.start),fresh=afterRows[ordinal];if(!fresh)throw new Error('改名后找不到图片引用');
            const mapped=referenceUpdate(updated,fresh,edit.target||fresh.src,rebasedUsed);if(mapped)rebased.push(mapped);}
          result=stamp(replaceSources(updated,rebased),time);await this.validate(result);
          log.resultHash=hash(Buffer.from(result));
        }
        for(const item of overwrites) {
          if(hash(await this.app.vault.adapter.readBinary(item.destination))!==item.previousSha256)throw new Error('图片处理期间发生变化，已停止覆盖');
          await this.mkdir(`${folder}/历史版本`);
          if(!(await this.app.vault.adapter.exists(item.backupImage)))await this.app.vault.createBinary(item.backupImage,item.oldData);
          if(hash(await this.app.vault.adapter.readBinary(item.backupImage))!==item.previousSha256)throw new Error('历史图片备份校验失败');
          await this.app.vault.modifyBinary(this.app.vault.getAbstractFileByPath(item.destination),item.data);applied.push(item);
          if(hash(await this.app.vault.adapter.readBinary(item.destination))!==item.sha256)throw new Error('替换图片校验失败');
        }
        if (changed.length) await this.app.vault.process(file,current => { if (current !== original&&(!renames.length||canonicalizeLinks(current,file.path,renames,true)!==canonicalizeLinks(original,file.path,renames))) throw new Error('文章已变化，正文未替换'); return result; });
      }catch(e){for(const item of applied.reverse())await this.app.vault.modifyBinary(this.app.vault.getAbstractFileByPath(item.destination),item.oldData);
        if(moved.length){for(const move of moved){if(move.current!==move.temp){await this.app.fileManager.renameFile(this.app.vault.getAbstractFileByPath(move.current),move.temp);move.current=move.temp;}}for(const move of moved.reverse())await this.app.fileManager.renameFile(this.app.vault.getAbstractFileByPath(move.current),move.from);}
        throw e;}
      // A repeated no-op must not destroy the preceding restorable backup.
      if(options.captionOverrides){
        const resultRows=scan(result),successful=new Set(report.filter(r=>r.status!=='失败').map(r=>r.source));log.captionChanges=[];
        for(const row of rows)if(successful.has(row.src)&&options.captionOverrides[row.start]!==undefined){
          const fresh=resultRows[full.findIndex(r=>r.start===row.start)];if(!fresh)continue;
          const key=this.captionKey(result,fresh,file),previous=this.settings?.captions?.[key];
          log.captionChanges.push({key,previous,hadPrevious:previous!==undefined,next:row.title});
        }
      }
      if (needsBackup) await this.app.vault.adapter.write(`${folder}/最近归集.json`,JSON.stringify(log,null,2));
      await this.app.vault.adapter.write(`${folder}/归集记录-${id}.json`,JSON.stringify(log,null,2));
      await this.rememberCaptions(file,result,full,rows,report,options.captionOverrides);
      new Notice(`归集完成：更新 ${report.filter(r=>r.status==='成功').length} 张，跳过 ${report.filter(r=>r.status==='跳过').length} 张，失败 ${report.filter(r=>r.status==='失败').length} 张。`,10000);
      return log;
    } finally { this.running = false; }
  }
  async restore(file) {
    if (!file || file.extension !== 'md') return new Notice('请先打开文章');
    if (this.running) return new Notice('归集正在运行，请完成后再恢复');
    this.running = true;
    try {
      const log = JSON.parse(await this.app.vault.adapter.read(`${this.folder(file)}/最近归集.json`));
      if (!log.backup) throw new Error('最近一次没有修改引用');
      const current = await this.app.vault.read(file);
      if (hash(Buffer.from(current)) !== log.resultHash) throw new Error('归集后文章已有其他修改，停止恢复以保护新增内容');
      const restored = stamp(await this.app.vault.adapter.read(log.backup),now());
      await this.validate(restored);
      const reverseMoves=(log.renames||[]).map(move=>({from:move.to,to:move.from,temp:move.temp,resultStat:move.resultStat}));
      const sources=new Set(reverseMoves.map(r=>r.from));
      for(const move of reverseMoves){if(!this.app.vault.getAbstractFileByPath(move.from))throw new Error('改名后的图片已缺失，停止恢复');
        const stat=this.app.vault.getAbstractFileByPath(move.from)?.stat;if(move.resultStat&&stat&&(stat.mtime!==move.resultStat.mtime||stat.size!==move.resultStat.size))throw new Error('改名后的图片已被修改，停止恢复');
        if(await this.app.vault.adapter.exists(move.to)&&!sources.has(move.to))throw new Error('原图片名称已被占用，停止恢复');
        if(await this.app.vault.adapter.exists(move.temp))throw new Error('临时改名文件已存在，停止恢复');}
      const oldImages=[];
      for(const image of log.images.filter(x=>x.backupImage)) {
        const latest=await this.app.vault.adapter.readBinary(image.destination),old=await this.app.vault.adapter.readBinary(image.backupImage);
        if(hash(latest)!==image.sha256||hash(old)!==image.previousSha256)throw new Error('图片已发生额外修改或历史备份异常，停止恢复');
        oldImages.push({file:this.app.vault.getAbstractFileByPath(image.destination),latest,old});
      }
      const applied=[],moved=[];
      try {
        for(const move of reverseMoves){await this.app.fileManager.renameFile(this.app.vault.getAbstractFileByPath(move.from),move.temp);moved.push({...move,current:move.temp});}
        for(const move of moved){await this.app.fileManager.renameFile(this.app.vault.getAbstractFileByPath(move.current),move.to);move.current=move.to;}
        for(const image of oldImages){await this.app.vault.modifyBinary(image.file,image.old);applied.push(image);}
        await this.app.vault.process(file,text => { if(text !== current&&(!reverseMoves.length||canonicalizeLinks(text,file.path,reverseMoves,true)!==canonicalizeLinks(current,file.path,reverseMoves))) throw new Error('文章已变化'); return restored; });
      }catch(e){for(const image of applied.reverse())await this.app.vault.modifyBinary(image.file,image.latest);
        if(moved.length){for(const move of moved){if(move.current!==move.temp){await this.app.fileManager.renameFile(this.app.vault.getAbstractFileByPath(move.current),move.temp);move.current=move.temp;}}for(const move of moved.reverse())await this.app.fileManager.renameFile(this.app.vault.getAbstractFileByPath(move.current),move.from);}throw e;}
      if(log.captionChanges?.length&&this.saveData){
        for(const change of log.captionChanges)if(this.settings?.captions?.[change.key]===change.next){if(change.hadPrevious)this.settings.captions[change.key]=change.previous;else delete this.settings.captions[change.key];}
        try{await this.saveData(this.settings);}catch(e){new Notice('文章已恢复，但图名设置未保存：'+e.message,8000);}
      }
      new Notice('已恢复归集前的引用和改名；新复制的图片仍保留');
    } catch(e) { new Notice(e.message,10000); }
    finally { this.running = false; }
  }
};
