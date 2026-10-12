'use strict';
const {Plugin, Modal, Notice, TFile, normalizePath, requestUrl} = require('obsidian');
const {scan, safeName, imageType, replaceSources, stamp, numberFigures, imageAtCursor, matchesImageStem, stripReferenceStamp, referenceUpdate, validateMarkdownMath} = require('./core');
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
        if(local.files?.length)options.data=await local.files[0].arrayBuffer();
        else {const address=url.value.trim();if(!/^https?:\/\//i.test(address))throw new Error('请选择图片或填写 http/https 图片网址');options.url=address;}
        const log=await this.plugin.collect(this.file,this.original,scan(this.original),options);
        if(log.images.some(x=>x.status==='失败'))throw new Error(log.images.find(x=>x.status==='失败').reason);
        this.close();new Result(this.app,log).open();
      }catch(e){status.textContent=e.message;button.disabled=false;}
    };
  }
  onClose(){this.contentEl.empty();}
}
class Preview extends Modal {
  constructor(plugin,file,text,rows,plan) { super(plugin.app); Object.assign(this,{plugin,file,text,rows,plan}); }
  onOpen() {
    this.modalEl.style.width='min(800px, 90vw)'; this.modalEl.style.minWidth='0';
    const el = this.contentEl; el.empty(); el.createEl('h2',{text:'归集当前文章图片'});
    const label=el.createEl('label',{text:'文件名图号：'}),select=label.createEl('select');
    for(const [value,text]of [['auto','自动（按文章 chapters 属性）'],['chapter','按章节：图2-1_图名'],['sequential','全文连续：图1_图名']])select.createEl('option',{value,text});
    select.value=this.plugin.settings?.numbering||'auto';
    select.onchange=async()=>{
      this.plugin.settings={numbering:select.value};await this.plugin.saveData(this.plugin.settings);
      this.rows=numberFigures(this.text,scan(this.text),select.value);
      this.plan=await Promise.all(this.rows.map(row=>this.plugin.managed(row,this.file)));this.onOpen();
    };
    el.createEl('p',{text:'图片文件夹与文章同级，命名为“（图件）完整文章名”；保留原图片，保存快照，成功后更新引用。'});
    const used=new Set([...this.text.matchAll(/#fig:([^\s}]+)/g)].map(m=>m[1]));
    const pending=this.rows.filter((row,i)=>!this.plan[i]||referenceUpdate(this.text,row,undefined,used));
    el.createEl('p',{text:`识别 ${this.rows.length} 处图片引用：待处理 ${pending.length} 张，已归集 ${this.rows.length-pending.length} 张将直接跳过。`});
    el.createEl('p',{text:'保存为“图号_论文图题”，新图添加 {#fig:时间戳} 标签，已有标签保持不变。'});
    el.createEl('p',{text:`目标文件夹：${this.plugin.folder(this.file)}`});
    const list = el.createEl('div'); list.style.maxHeight = '50vh'; list.style.overflow = 'auto';
    for (const row of pending) {
      const item = list.createEl('p'); item.style.overflowWrap='anywhere';
      item.createEl('strong',{text:row.filename||safeName(row.title)}); item.createEl('br');
      if(row.warning)item.createEl('span',{text:row.warning});
      let display=row.src; try {display=decodeURIComponent(display);} catch {}
      const source=item.createEl('span',{text:`来源：${display}`}); source.style.fontSize='0.85em'; source.style.color='var(--text-muted)';
    }
    if(!pending.length)el.createEl('p',{text:'所有图片已归集，当前没有需要更新的图片。'});
    const button = el.createEl('button',{text:pending.length?'仅归集待处理图片':'无需更新'}); button.disabled=!pending.length;
    button.onclick = async () => { button.disabled = true; button.textContent = '正在归集，请稍候…'; try { const report = await this.plugin.collect(this.file,this.text,this.rows); this.close(); new Result(this.app,report).open(); } catch(e) { el.createEl('p',{text:e.message}); button.disabled = false; button.textContent = '重新尝试'; } };
  }
  onClose() { this.contentEl.empty(); }
}
class Result extends Modal {
  constructor(app,report) { super(app); this.report=report; }
  onOpen() {
    this.modalEl.style.width='min(700px, 90vw)'; this.modalEl.style.minWidth='0';
    this.contentEl.createEl('h2',{text:'图片归集结果'});
    this.contentEl.createEl('p',{text:`更新 ${this.report.images.filter(x=>x.status==='成功').length} 张，跳过 ${this.report.images.filter(x=>x.status==='跳过').length} 张，失败 ${this.report.images.filter(x=>x.status==='失败').length} 张。`});
    this.contentEl.createEl('p',{text:`文件夹：${this.report.folder}`});
    for (const row of this.report.images.filter(x=>x.status==='失败')) this.contentEl.createEl('p',{text:`${row.source}：${row.reason}`});
    this.contentEl.createEl('p',{text:'可在命令面板运行“文章图片归集：恢复最近一次归集前的文章”。恢复前会检查文章是否已有其他修改。'});
    this.contentEl.createEl('button',{text:'完成'}).onclick=()=>this.close();
  }
  onClose() { this.contentEl.empty(); }
}
module.exports = class Collector extends Plugin {
  async onload() {
    this.running = false;
    this.settings=Object.assign({numbering:'auto'},await this.loadData());
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
      const row=numberFigures(original,scan(original),this.settings?.numbering||'auto').find(x=>x.start===raw.start);
      new ReplaceImage(this,file,original,row).open();
    }catch(e){new Notice(e.message,8000);}
  }
  async preview(file) {
    if (!file || file.extension !== 'md') return new Notice('请先打开 Markdown 文章');
    const text = await this.app.vault.read(file), rows = numberFigures(text,scan(text),this.settings?.numbering||'auto');
    if (!rows.length) return new Notice('没有识别到图片引用');
    const plan=await Promise.all(rows.map(row=>this.managed(row,file)));
    new Preview(this,file,text,rows,plan).open();
  }
  resolve(src,file) {
    src=stripReferenceStamp(src);
    let decoded; try { decoded = decodeURIComponent(src); } catch { decoded = src; }
    const direct = this.app.vault.getAbstractFileByPath(normalizePath(decoded));
    if (direct instanceof TFile) return direct;
    return this.app.metadataCache.getFirstLinkpathDest(decoded,file.path);
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
      const full=numberFigures(original,scan(original),this.settings?.numbering||'auto');
      const wanted=new Set(rows.map(row=>row.start));
      rows=full.filter(row=>wanted.has(row.start) && (options.onlyStart===undefined||row.start===options.onlyStart));
      if(options.onlyStart!==undefined&&!rows.length)throw new Error('找不到所选图片，请重新选择');
      const folder = this.folder(file);
      const report = []; const changed = [],overwrites=[];
      const used=new Set([...original.matchAll(/#fig:([^\s}]+)/g)].map(m=>m[1]));
      for (const row of rows) {
        try {
          const existing=options.force?null:await this.managed(row,file);
          if(existing){const update=referenceUpdate(original,row,undefined,used);if(update)changed.push(update);report.push(update?{...existing,status:'成功',reason:'仅更新引用标签，图片未重新保存'}:existing);continue;}
          let data;const source=options.url||row.src;
          if(options.data!==undefined)data=options.data;
          else if (/^https?:\/\//i.test(source)) { const res = await requestUrl({url:source,throw:false}); if (res.status < 200 || res.status >= 300) throw new Error(`下载失败 HTTP ${res.status}`); data = res.arrayBuffer; }
          else { const local = this.resolve(row.src,file); if (!(local instanceof TFile)) throw new Error('找不到库内文件；库外文件请先导入库内'); data = await this.app.vault.readBinary(local); }
          const ext = imageType(data), digest = hash(data), base = row.filename||safeName(row.title);
          await this.mkdir(folder);
          const savedAt=versionTime();
          const dest = normalizePath(`${folder}/${base}.${ext}`);
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
        } catch(e) { report.push({source:row.src,status:'失败',reason:e.message}); }
      }
      if (await this.app.vault.read(file) !== original) throw new Error('处理期间文章已变化。图片已保存，正文未替换，请重新预览');
      const time = now(), id = `${time.replace(/[^0-9]/g,'')}-${Date.now()}`;
      if(!changed.length&&!overwrites.length&&report.every(row=>row.status==='跳过')) {
        const log={article:file.path,folder,time,backup:null,resultHash:hash(Buffer.from(original)),images:report};
        new Notice(`无需更新：${report.length} 张图片已归集，全部跳过。`,6000);
        return log;
      }
      const needsBackup=changed.length||overwrites.length;
      await this.mkdir(folder);
      const backup = `${folder}/归集前-${id}.snapshot`, result = changed.length ? stamp(replaceSources(original,changed),time) : original;
      if (changed.length) await this.validate(result);
      if (needsBackup) await this.app.vault.adapter.write(backup,original);
      const log = {article:file.path,folder,time,backup:needsBackup?backup:null,resultHash:hash(Buffer.from(result)),images:report};
      await this.mkdir(folder);
      await this.app.vault.adapter.write(`${folder}/归集记录-${id}.json`,JSON.stringify(log,null,2));
      const applied=[];
      try {
        for(const item of overwrites) {
          if(hash(await this.app.vault.adapter.readBinary(item.destination))!==item.previousSha256)throw new Error('图片处理期间发生变化，已停止覆盖');
          await this.mkdir(`${folder}/历史版本`);
          if(!(await this.app.vault.adapter.exists(item.backupImage)))await this.app.vault.createBinary(item.backupImage,item.oldData);
          if(hash(await this.app.vault.adapter.readBinary(item.backupImage))!==item.previousSha256)throw new Error('历史图片备份校验失败');
          await this.app.vault.modifyBinary(this.app.vault.getAbstractFileByPath(item.destination),item.data);applied.push(item);
          if(hash(await this.app.vault.adapter.readBinary(item.destination))!==item.sha256)throw new Error('替换图片校验失败');
        }
        if (changed.length) await this.app.vault.process(file,current => { if (current !== original) throw new Error('文章已变化，正文未替换'); return result; });
      }catch(e){for(const item of applied.reverse())await this.app.vault.modifyBinary(this.app.vault.getAbstractFileByPath(item.destination),item.oldData);throw e;}
      // A repeated no-op must not destroy the preceding restorable backup.
      if (needsBackup) await this.app.vault.adapter.write(`${folder}/最近归集.json`,JSON.stringify(log,null,2));
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
      const oldImages=[];
      for(const image of log.images.filter(x=>x.backupImage)) {
        const latest=await this.app.vault.adapter.readBinary(image.destination),old=await this.app.vault.adapter.readBinary(image.backupImage);
        if(hash(latest)!==image.sha256||hash(old)!==image.previousSha256)throw new Error('图片已发生额外修改或历史备份异常，停止恢复');
        oldImages.push({file:this.app.vault.getAbstractFileByPath(image.destination),latest,old});
      }
      const applied=[];
      try {for(const image of oldImages){await this.app.vault.modifyBinary(image.file,image.old);applied.push(image);}
        await this.app.vault.process(file,text => { if(text !== current) throw new Error('文章已变化'); return restored; });
      }catch(e){for(const image of applied.reverse())await this.app.vault.modifyBinary(image.file,image.latest);throw e;}
      new Notice('已恢复归集前的引用；已保存的图片仍保留');
    } catch(e) { new Notice(e.message,10000); }
    finally { this.running = false; }
  }
};
