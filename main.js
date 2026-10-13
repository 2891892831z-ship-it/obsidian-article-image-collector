'use strict';
const {Plugin, Modal, Notice, TFile, normalizePath, requestUrl, getLanguage, PluginSettingTab} = require('obsidian');
const {scan, safeName, imageType, replaceSources, stamp, numberFigures, imageAtCursor, matchesImageStem, stripReferenceStamp, referenceUpdate, validateMarkdownMath, figureId, referencePath, candidatePaths, canonicalizeLinks, vaultReferenceCandidates} = require('./core');
const {translate,resolveLanguage}=require('./i18n');
const crypto = require('crypto');
function now() { const d = new Date(), p = n => String(n).padStart(2,'0'); return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
function hash(b) { return crypto.createHash('sha256').update(Buffer.from(b)).digest('hex'); }
function versionTime() { const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3,'0')}`; }
class ImageViewer extends Modal {
  constructor(plugin,source,title){super(plugin.app);Object.assign(this,{plugin,source,title});}
  onOpen(){
    this.modalEl.style.width='min(1100px,94vw)';
    this.contentEl.createEl('h2',{text:this.title});
    const image=this.contentEl.createEl('img',{attr:{src:this.source,alt:this.title,referrerpolicy:'no-referrer'}});
    image.style.cssText='display:block;max-width:100%;max-height:72vh;object-fit:contain;margin:auto';
    image.onerror=()=>{image.style.display='none';this.contentEl.createEl('p',{text:this.plugin.t('图片暂时无法预览，请检查来源或图片格式。')});};
    this.contentEl.createEl('button',{text:this.plugin.t('关闭预览')}).onclick=()=>this.close();
  }
  onClose(){this.contentEl.empty();}
}
class Integrity extends Modal {
  constructor(plugin,file,text,rows,plan){super(plugin.app);Object.assign(this,{plugin,file,text,rows,plan});}
  onOpen(){
    const t=(message,...args)=>this.plugin.t(message,...args),el=this.contentEl;
    this.modalEl.style.width='min(800px,90vw)';el.empty();el.createEl('h2',{text:t('检查图片完整性')});
    const missing=this.rows.filter((r,i)=>this.plan[i].action==='missing');
    const remote=this.rows.filter(r=>/^https?:\/\//i.test(r.src));
    const recoverable=this.rows.filter((r,i)=>this.plan[i].action==='missing'&&this.plan[i].recovery);
    el.createEl('p',{text:t('共 {0} 张 · 本地可用 {1} 张 · 缺失 {2} 张 · 可恢复 {3} 张 · 网络引用 {4} 张',this.rows.length,this.rows.length-missing.length-remote.length,missing.length,recoverable.length,remote.length)});
    el.createEl('p',{text:t('检查不会修改文章或下载网络图片；网络地址是否可用需以加载或恢复结果为准。')});
    const list=el.createEl('div');list.style.cssText='max-height:50vh;overflow:auto';
    this.rows.forEach((row,i)=>{
      const plan=this.plan[i],card=list.createEl('details');card.open=plan.action==='missing';card.style.cssText='padding:10px;margin:6px 0;border:1px solid var(--background-modifier-border);border-radius:8px';
      card.createEl('summary',{text:row.filename+' · '+t(plan.action==='missing'?'缺失':/^https?:\/\//i.test(row.src)?'网络引用（未验证）':'本地可用')});
      if(plan.action==='missing')card.style.borderColor='var(--color-orange,#d97706)';
      card.createEl('p',{text:t(plan.reason)});this.plugin.sourceDetails(card,row,this.file,this.text,plan);
      this.plugin.thumbnail(card,row,this.file,plan,plan.action==='missing');
      if(plan.action==='missing'){
        if(plan.recovery)card.createEl('button',{text:t('恢复这张图片')}).onclick=async()=>{try{const log=await this.plugin.recoverImages(this.file,this.text,[row],[plan]);this.close();new Result(this.app,log,this.plugin).open();}catch(e){new Notice(t(e.message),8000);}};
        card.createEl('button',{text:t('重新选择图片（本地 / 网址 / 库内）')}).onclick=()=>new ReplaceImage(this.plugin,this.file,this.text,row).open();
      }
    });
    const batch=el.createEl('button',{text:t('恢复全部可恢复图片（{0} 张）',recoverable.length)});batch.disabled=!recoverable.length;
    batch.onclick=async()=>{batch.disabled=true;try{const pairs=this.rows.map((row,i)=>({row,plan:this.plan[i]})).filter(x=>x.plan.action==='missing'&&x.plan.recovery);const log=await this.plugin.recoverImages(this.file,this.text,pairs.map(x=>x.row),pairs.map(x=>x.plan));this.close();new Result(this.app,log,this.plugin).open();}catch(e){new Notice(t(e.message),8000);batch.disabled=false;}};
    el.createEl('button',{text:t('重新检查')}).onclick=()=>{this.close();this.plugin.checkIntegrity(this.file);};
  }
  onClose(){this.contentEl.empty();}
}
class ReplaceImage extends Modal {
  constructor(plugin,file,original,row) {super(plugin.app);Object.assign(this,{plugin,file,original,row});}
  onOpen() {
    const t=(message,...args)=>this.plugin.t(message,...args);
    this.modalEl.style.width='min(700px,90vw)';this.modalEl.style.minWidth='0';
    const el=this.contentEl;el.empty();el.createEl('h2',{text:t('替换当前图片')});
    el.createEl('p',{text:t('{0}：图片文件名不加时间戳，新图使用 {#fig:时间戳} 标签，换图保留已有标签。替换同名图片，旧内容保存到历史版本，保留图题、标签和宽度。',this.row.filename)});
    el.createEl('p',{text:t('选择电脑上的新图片，填写图片网址，或粘贴库内图片路径（基于库的相对路径 / 绝对路径 / obsidian:// 链接均可）。')});
    const local=el.createEl('input',{type:'file'});local.accept='.png,.jpg,.jpeg,.svg,.gif,.webp,.bmp,.avif,.tif,.tiff';
    const url=el.createEl('input',{type:'text',placeholder:t('https://… 或库内路径，如 4-成果/…/图.png')});url.style.cssText='width:100%;box-sizing:border-box';
    const status=el.createEl('p');status.style.cssText='min-height:1.4em;font-size:0.85em;color:var(--text-muted);margin:6px 0';
    const resolveVault=()=>{const address=url.value.trim();if(!address||/^(?:https?:)?\/\//i.test(address))return null;return this.plugin.parseVaultReference(address,this.file.path);};
    url.oninput=()=>{
      const found=resolveVault();
      if(found)status.textContent=t('✓ 将使用库内图片：{0}',found.path);
      else if(url.value.trim()&&!/^(?:https?:)?\/\//i.test(url.value.trim()))status.textContent=t('未识别为网址；尚未在库内匹配到该路径');
      else status.textContent='';
    };
    const button=el.createEl('button',{text:t('保存新版本并替换引用')});
    button.onclick=async()=>{
      button.disabled=true;
      try {
        const address=url.value.trim();
        if(local.files?.length && address)throw new Error('请选择本地图片或网址其中一种');
        const options={onlyStart:this.row.start,force:true};
        if(this.row.captionSource==='手动图名')options.captionOverrides={[this.row.start]:this.row.title};
        if(local.files?.length){options.data=await local.files[0].arrayBuffer();options.localFilename=local.files[0].name;}
        else {
          const vaultFile=resolveVault();
          if(vaultFile){
            if(!/\.(png|jpe?g|gif|webp|svg|bmp|avif|tiff?)$/i.test(vaultFile.path))throw new Error(t('库内文件不是图片：{0}',vaultFile.path));
            options.data=await this.plugin.app.vault.readBinary(vaultFile);options.localFilename=vaultFile.name;options.vaultPath=vaultFile.path;
          }
          else if(/^https?:\/\//i.test(address))options.url=address;
          else throw new Error('请选择图片、填写图片网址，或粘贴库内图片路径');
        }
        const log=await this.plugin.collect(this.file,this.original,scan(this.original),options);
        if(log.images.some(x=>x.status==='失败'))throw new Error(log.images.find(x=>x.status==='失败').reason);
        this.close();new Result(this.app,log,this.plugin).open();
      }catch(e){status.textContent=t(e.message);button.disabled=false;}
    };
  }
  onClose(){this.contentEl.empty();}
}
class Preview extends Modal {
  constructor(plugin,file,text,rows,plan) { super(plugin.app); Object.assign(this,{plugin,file,text,rows,plan});this.selected=new Set();this.overrides={}; }
  onOpen() {
    const t=(message,...args)=>this.plugin.t(message,...args);
    this.modalEl.style.width='min(800px, 90vw)'; this.modalEl.style.minWidth='0';
    const el = this.contentEl; el.empty();
    const header=el.createEl('div');header.style.cssText='display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px 20px;margin:0 0 20px;padding-right:20px';
    const title=header.createEl('h2',{text:t('归集当前文章图片')});title.style.cssText='margin:0;line-height:1.3;flex:1 1 240px';
    const language=this.plugin.languageControl(header,()=>this.onOpen());language.languageLabel.style.cssText='display:flex;align-items:center;gap:8px;margin:0;font-size:0.9em;flex:0 1 auto;flex-wrap:wrap';
    const label=el.createEl('label',{text:t('文件名图号：')}),select=label.createEl('select');
    for(const [value,text]of [['auto','自动（按文章 chapters 属性）'],['chapter','按章节：图2-1_图名'],['sequential','全文连续：图1_图名']])select.createEl('option',{value,text:t(text)});
    select.value=this.plugin.settings?.numbering||'auto';
    select.onchange=async()=>{
      this.plugin.settings.numbering=select.value;await this.plugin.saveData(this.plugin.settings);
      this.rows=this.plugin.articleRows(this.text,this.file,this.overrides);
      this.plan=await Promise.all(this.rows.map(row=>this.plugin.inspect(row,this.file,this.text)));this.onOpen();
    };
    const pending=this.rows.filter((row,i)=>this.plan[i].action!=='skip');
    const attention=this.rows.filter((row,i)=>this.plan[i].action!=='skip'||row.needsCaptionReview);
    if(this.onlyPending===undefined)this.onlyPending=attention.length>0;
    const counts=el.createEl('p',{text:t('共 {0} 张 · 待处理 {1} 张 · 已归集 {2} 张',this.rows.length,pending.length,this.rows.length-pending.length)});
    counts.style.cssText='margin:10px 0;font-size:0.9em;color:var(--text-muted)';
    el.createEl('button',{text:t('检查图片完整性')}).onclick=()=>this.plugin.checkIntegrity(this.file);
    const help=el.createEl('details');help.style.cssText='font-size:0.85em;color:var(--text-muted);margin-bottom:10px';
    help.createEl('summary',{text:t('保存位置与命名规则')});
    help.createEl('p',{text:t('与文章同级：{0}',this.plugin.folder(this.file))});
    help.createEl('p',{text:t('文件名为“图号_图题”，不加时间戳；新图添加 {#fig:时间戳} 标签，已有标签保持不变。')});
    const filterLabel=el.createEl('label');filterLabel.style.cssText='display:inline-flex;align-items:center;gap:10px;min-height:44px;max-width:100%;box-sizing:border-box;padding:10px 16px;margin:10px 0;border:1px solid var(--background-modifier-border);border-radius:10px;font-size:15px;font-weight:600;line-height:1.4;cursor:pointer;background:var(--background-secondary)';
    const filter=filterLabel.createEl('input',{type:'checkbox'});filter.checked=this.onlyPending;
    filter.style.cssText='width:22px;height:22px;min-width:22px;margin:0;flex-shrink:0;cursor:pointer;accent-color:var(--interactive-accent)';
    filterLabel.createEl('span',{text:t('只看待处理 / 需确认')});
    filter.setAttribute('aria-label',t('只看待处理 / 需确认'));
    const cards=[];
    const applyFilter=()=>cards.forEach(x=>x.item.style.display=this.onlyPending&&!x.attention?'none':'');
    const paintFilter=()=>{filterLabel.style.borderColor=filter.checked?'var(--interactive-accent)':'var(--background-modifier-border)';};paintFilter();
    filter.onchange=()=>{this.onlyPending=filter.checked;paintFilter();applyFilter();};
    const summary=el.createEl('p'),checks=[];
    const refresh=()=>{summary.textContent=t('已选 {0} / {1} 张；未勾选图片不处理。',this.selected.size,this.rows.length);button.disabled=!this.selected.size;};
    el.createEl('button',{text:t('全选待处理')}).onclick=()=>{checks.forEach(x=>{x.check.checked=x.plan.action!=='skip';if(x.check.checked)this.selected.add(x.row.start);else this.selected.delete(x.row.start);});refresh();};
    el.createEl('button',{text:t('取消全选')}).onclick=()=>{this.selected.clear();checks.forEach(x=>x.check.checked=false);refresh();};
    const list = el.createEl('div'); list.style.maxHeight = '50vh'; list.style.overflow = 'auto';
    this.rows.forEach((row,i)=>{
      const plan=this.plan[i],item=list.createEl('div');item.style.cssText='margin:6px 0;padding:8px 10px;border:1px solid var(--background-modifier-border);border-radius:8px;overflow-wrap:anywhere';
      const needsName=row.needsCaptionReview,needsSource=plan.action==='missing';
      const attention=plan.action!=='skip'||needsName;cards.push({item,attention});
      if(needsName||needsSource){
        item.style.border='2px solid var(--color-orange, #d97706)';
        item.style.borderLeft='6px solid var(--color-orange, #d97706)';
        const alert=item.createEl('p',{text:t(needsName&&needsSource?'⚠ 建议补填图名 · 需要修复图片来源':needsSource?'⚠ 需要修复图片来源':'✎ 建议补填图名（可跳过）')});
        alert.style.cssText='font-weight:700;color:var(--color-orange, #d97706);margin:0 0 6px;font-size:0.9em';
      }
      const body=item.createEl('details');body.open=attention;
      const bodySummary=body.createEl('summary');bodySummary.style.cssText='cursor:pointer;line-height:1.6';
      const label=bodySummary.createEl('label'),check=label.createEl('input',{type:'checkbox'});
      label.onclick=event=>event.stopPropagation();
      if(!this.initialized&&plan.action!=='skip')this.selected.add(row.start);
      check.checked=this.selected.has(row.start);label.createEl('strong',{text:` ${row.filename}`});
      check.onchange=()=>{if(check.checked)this.selected.add(row.start);else this.selected.delete(row.start);refresh();};checks.push({check,row,plan});
      const badge=bodySummary.createEl('span',{text:t(attention?' · 待确认 / 处理':' · 已归集')});badge.style.cssText='font-size:0.8em;color:var(--text-muted);font-weight:400';
      this.plugin.thumbnail(body,row,this.file,plan,attention);
      body.createEl('p',{text:t('MD 中原文件名：{0}（第 {1} 行）',row.originalFilename||t('无法取得文件名'),row.originalLine)});
      body.createEl('p',{text:t('MD 中原图题：{0}',row.originalCaption||t('空（原引用未填写图题）'))});
      const details=body.createEl('details');details.createEl('summary',{text:t('查看原引用与完整路径')});
      details.createEl('p',{text:row.originalSyntax});details.createEl('p',{text:t('原路径：{0}',row.src)});
      details.createEl('p',{text:t('将保存为：{0}',plan.destination||this.plugin.folder(this.file)+'/'+row.filename+'.…')});
      this.plugin.sourceDetails(details,row,this.file,this.text,plan);
      body.createEl('p',{text:t('{0} · 图题来源：{1} · {2}',row.chapter?t('第 {0} 章',row.chapter):t(row.numbering==='sequential'?'全文连续编号':'未识别章节'),t(row.captionSource),t(plan.reason))});
      if(row.warning)body.createEl('p',{text:t(row.warning)});

      const nameLabel=body.createEl('label',{text:t(needsName?'↓ 在这里输入图名（可选）':'保存图名（可编辑）')});nameLabel.style.cssText='display:block;font-weight:600;margin-top:8px;font-size:0.9em';
      if(needsName)nameLabel.style.color='var(--color-orange, #d97706)';
      const input=nameLabel.createEl('input',{type:'text',value:row.needsCaptionReview&&row.title==='未命名图片'?'':row.title,placeholder:t(needsName?'例如：实验室平台照片；留空也可继续':'输入新的图名')});input.style.cssText='display:block;width:100%;margin-top:6px;box-sizing:border-box';input.setAttribute('aria-label',t('保存图片的图名'));
      if(needsName){input.style.border='2px solid var(--color-orange, #d97706)';input.style.minHeight='34px';}
      input.onchange=async()=>{this.overrides[row.start]=input.value.trim();this.rows=this.plugin.articleRows(this.text,this.file,this.overrides);this.plan=await Promise.all(this.rows.map(r=>this.plugin.inspect(r,this.file,this.text)));this.onOpen();};
      body.createEl('button',{text:t('重新选择图片（本地 / 网址 / 库内）')}).onclick=()=>new ReplaceImage(this.plugin,this.file,this.text,row).open();
      if(plan.action==='missing'&&plan.recovery)body.createEl('button',{text:t(plan.recovery.kind==='trash'?'从库内回收站恢复':plan.recovery.kind==='local'?'确认使用找到的库内图片':'从归集记录重新获取')}).onclick=async()=>{
        try{
          const log=await this.plugin.recoverImages(this.file,this.text,[row],[plan]);this.close();new Result(this.app,log,this.plugin).open();
        }catch(e){new Notice(t(e.message),8000);}
      };
      for(const child of body.children)if(child.tagName==='P')child.style.cssText='margin:6px 0;font-size:0.85em;color:var(--text-muted)';
    });this.initialized=true;applyFilter();
    if(!pending.length)el.createEl('p',{text:t('所有图片已归集，当前没有需要更新的图片。')});
    const button = el.createEl('button',{text:t('处理勾选图片')});refresh();
    button.onclick = async () => { button.disabled = true; button.textContent = t('正在处理，请稍候…'); try { const report = await this.plugin.collect(this.file,this.text,this.rows.filter(r=>this.selected.has(r.start)),{captionOverrides:this.overrides}); this.close(); new Result(this.app,report,this.plugin).open(); } catch(e) { el.createEl('p',{text:t(e.message)}); button.textContent = t('重新尝试');refresh(); } };
  }
  onClose() { this.contentEl.empty(); }
}
class Result extends Modal {
  constructor(app,report,plugin) { super(app); this.report=report;this.plugin=plugin; }
  onOpen() {
    const t=(message,...args)=>this.plugin.t(message,...args);
    this.modalEl.style.width='min(700px, 90vw)'; this.modalEl.style.minWidth='0';
    this.contentEl.createEl('h2',{text:t('图片归集结果')});
    this.contentEl.createEl('p',{text:t('更新 {0} 张，跳过 {1} 张，失败 {2} 张。',this.report.images.filter(x=>x.status==='成功').length,this.report.images.filter(x=>x.status==='跳过').length,this.report.images.filter(x=>x.status==='失败').length)});
    this.contentEl.createEl('p',{text:t('文件夹：{0}',this.report.folder)});
    for (const row of this.report.images.filter(x=>x.status==='失败')) this.contentEl.createEl('p',{text:`${row.source}: ${t(row.reason)}`});
    if(this.plugin&&this.report.images.some(x=>x.status==='失败'))this.contentEl.createEl('button',{text:t('返回预览：恢复或重新选择来源')}).onclick=()=>{this.close();this.plugin.preview(this.app.vault.getAbstractFileByPath(this.report.article));};
    this.contentEl.createEl('p',{text:t('可在命令面板运行“文章图片归集：恢复最近一次归集前的文章”。恢复前会检查文章是否已有其他修改。')});
    this.contentEl.createEl('button',{text:t('完成')}).onclick=()=>this.close();
  }
  onClose() { this.contentEl.empty(); }
}
class LanguageSettings extends PluginSettingTab {
  display() {const el=this.containerEl;el.empty();this.plugin.languageControl(el,()=>this.display());el.createEl('p',{text:this.plugin.t('只切换插件界面语言，不修改文章、图名或现有文件路径。')});}
}
module.exports = class Collector extends Plugin {
  language() {
    let host='zh';
    try {host=typeof getLanguage==='function'?getLanguage():(globalThis.localStorage?.getItem('language')||globalThis.navigator?.language||'zh');}catch{}
    return resolveLanguage(this.settings?.language,host);
  }
  t(message,...args) {return translate(message,this.language(),...args);}
  languageControl(el,refresh) {
    const label=el.createEl('label',{text:'语言 / Language '});label.style.cssText='display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-bottom:12px;font-size:0.9em';
    const select=label.createEl('select');select.setAttribute('aria-label','语言 / Language');
    for(const [value,text]of [['auto',this.t('跟随 Obsidian')],['zh','简体中文'],['en','English']])select.createEl('option',{value,text});
    select.value=this.settings?.language||'auto';
    select.onchange=async()=>{const previous=this.settings.language||'auto';this.settings.language=select.value;try{await this.saveData(this.settings);refresh();}catch(e){this.settings.language=previous;select.value=previous;new Notice(this.t(e.message),8000);}};
    select.languageLabel=label;return select;
  }
  async onload() {
    this.running = false;
    this.settings=Object.assign({numbering:'auto',captions:{},language:'auto',sources:{}},await this.loadData());
    this.addSettingTab(new LanguageSettings(this.app,this));
    this.enableLongPathImages();
    this.addCommand({id:'collect-current-article-images',name:'归集当前文章图片 / Collect article images',callback:() => this.preview(this.app.workspace.getActiveFile())});
    this.addCommand({id:'restore-current-article-images',name:'恢复最近一次归集前的文章 / Restore article before last collection',callback:() => this.restore(this.app.workspace.getActiveFile())});
    this.addCommand({id:'replace-current-image',name:'替换光标所在图片（保留图题和编号） / Replace image at cursor (keep caption and number)',editorCallback:(editor,view)=>this.replaceAtEditor(editor,view.file)});
    this.addCommand({id:'check-article-images',name:'检查图片完整性 / Check image integrity',callback:()=>this.checkIntegrity(this.app.workspace.getActiveFile())});
    this.registerEvent(this.app.workspace.on('editor-menu',(menu,editor,view)=>{
      if(imageAtCursor(editor.getValue(),editor.posToOffset(editor.getCursor())))menu.addItem(item=>item.setTitle(this.t('替换当前图片（保留图题和编号）')).setIcon('image').onClick(()=>this.replaceAtEditor(editor,view.file)));
    }));
    this.registerEvent(this.app.workspace.on('file-menu',(menu,file) => { if (file instanceof TFile && file.extension === 'md') menu.addItem(item => item.setTitle(this.t('归集当前文章图片')).setIcon('image').onClick(() => this.preview(file))); }));
    this.registerEvent(this.app.vault.on('rename',(file,oldPath) => this.onArticleRenamed(file,oldPath)));
  }
  folder(file) { return normalizePath(`${file.parent.path === '/' ? '' : file.parent.path + '/'}（图件）${file.basename}`); }
  async onArticleRenamed(file, oldPath) {
    try {
      if (this.running) return;
      if (!(file instanceof TFile) || file.extension !== 'md') return;
      const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
      const baseOf = p => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/i, '');
      const oldFolder = normalizePath(`${dirOf(oldPath) ? dirOf(oldPath) + '/' : ''}（图件）${baseOf(oldPath)}`);
      const newFolder = this.folder(file);
      if (oldFolder === newFolder) return;
      // 文章路径已变：先迁移 data.json 中的图名与来源记录键
      let migrated = false;
      if (this.settings && this.saveData) {
        const s = this.settings, prefix = oldPath + '::';
        if (s.captions) for (const key of Object.keys(s.captions)) {
          if (key.startsWith(prefix)) { s.captions[file.path + '::' + key.slice(prefix.length)] = s.captions[key]; delete s.captions[key]; migrated = true; }
        }
        if (s.sources && Object.prototype.hasOwnProperty.call(s.sources, oldPath)) {
          s.sources[file.path] = s.sources[oldPath]; delete s.sources[oldPath]; migrated = true;
        }
        if (migrated) await this.saveData(s);
      }
      if (!(await this.app.vault.adapter.exists(oldFolder))) return;
      if (await this.app.vault.adapter.exists(newFolder)) {
        new Notice(this.t('文章已重命名，但新图件文件夹已存在，旧文件夹保留：{0}', oldFolder), 8000);
        return;
      }
      const target = this.app.vault.getAbstractFileByPath(oldFolder);
      if (!target) return;
      await this.app.fileManager.renameFile(target, newFolder);
      new Notice(this.t('文章已重命名，图件文件夹已同步：{0} → {1}', oldFolder.split('/').pop(), newFolder.split('/').pop()), 6000);
    } catch (e) {
      new Notice(this.t('文章改名后同步图件文件夹失败：{0}', e && e.message ? e.message : e), 8000);
    }
  }
  enableLongPathImages(){
    const base=this.app.vault.adapter.getBasePath?.().replace(/\\/g,'/');
    if(!base||!/^\w:\//.test(base)||typeof document==='undefined')return;
    const cache=new Map(),urls=new Set(),pending=new WeakSet();let stopped=false,queued=false;
    const resolve=image=>{
      const src=image.getAttribute('src')||'';
      if(src.startsWith('app://')){
        try{const absolute=decodeURIComponent(new URL(src).pathname).replace(/^\/(?=[A-Za-z]:\/)/,'');
          if(absolute.toLowerCase().startsWith(base.toLowerCase()+'/'))return this.app.vault.getAbstractFileByPath(absolute.slice(base.length+1));
        }catch{}
      }
      if(!src)for(const leaf of this.app.workspace.getLeavesOfType('image'))if(leaf.view.contentEl.contains(image))return leaf.view.file;
      return null;
    };
    const repair=async image=>{
      if(pending.has(image))return;
      const file=resolve(image);if(!(file instanceof TFile)||(base+'/'+file.path).length<260||!/^(png|jpe?g|gif|webp|bmp|avif|tiff?|svg)$/i.test(file.extension))return;
      const original=image.getAttribute('src');pending.add(image);
      try{
        const key=file.path+'::'+(file.stat?.mtime||0)+'::'+(file.stat?.size||0);
        if(!cache.has(key))cache.set(key,(async()=>{const data=await this.app.vault.readBinary(file),ext=imageType(data);const mime={jpg:'image/jpeg',svg:'image/svg+xml',tif:'image/tiff'}[ext]||'image/'+ext;const url=URL.createObjectURL(new Blob([data],{type:mime}));urls.add(url);return url;})());
        const url=await cache.get(key);
        if(!stopped&&image.isConnected&&image.getAttribute('src')===original)image.src=url;
      }catch{}finally{pending.delete(image);}
    };
    const scanImages=()=>{
      queued=false;if(stopped)return;
      for(const image of document.querySelectorAll('img[src^="app://"],.image-container img:not([src]),.image-container img[src=""]'))repair(image);
      // Keep URLs only while a visible image uses them; closing a tab releases decoded resources.
      const used=new Set([...document.querySelectorAll('img[src^="blob:"]')].map(i=>i.src));
      for(const url of urls)if(!used.has(url)){URL.revokeObjectURL(url);urls.delete(url);for(const [key,promise]of cache)promise.then(value=>{if(value===url)cache.delete(key);});}
    };
    const schedule=()=>{if(!queued&&!stopped){queued=true;queueMicrotask(scanImages);}};
    const observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
    this.registerDomEvent(document,'error',schedule,true);
    this.registerEvent(this.app.workspace.on('layout-change',schedule));
    this.registerEvent(this.app.vault.on('modify',file=>{for(const key of cache.keys())if(key.startsWith(file.path+'::'))cache.delete(key);for(const leaf of this.app.workspace.getLeavesOfType('image'))if(leaf.view.file===file){const image=leaf.view.contentEl.querySelector('img');if(image)image.src=this.app.vault.getResourcePath(file);}schedule();}));
    this.register(()=>{stopped=true;observer.disconnect();for(const url of urls)URL.revokeObjectURL(url);urls.clear();cache.clear();});schedule();
  }
  sourceRecord(row,file,text){
    const records=this.settings?.sources?.[file.path]||[],id=figureId(text,row),paths=candidatePaths(row.src,file.path);
    return records.find(r=>id&&r.figureId===id)||records.find(r=>paths.includes(r.destination));
  }
  async importRecordedSources(file,text){
    if(!this.saveData)return;
    let log;try{log=await this.readLog(this.folder(file));}catch{return;}
    const current=scan(text),records=this.settings?.sources?.[file.path]||[];let changed=false;
    for(const image of log.images||[]){
      if(image.status==='失败'||!image.destination)continue;
      const row=current.find(r=>candidatePaths(r.src,file.path).includes(image.destination));if(!row||this.sourceRecord(row,file,text))continue;
      const incoming=image.replacementSource||image.source;
      if(!incoming||incoming==='本地选择图片'||candidatePaths(incoming,file.path).some(p=>p.startsWith(this.folder(file)+'/')))continue;
      records.push({figureId:figureId(text,row),destination:image.destination,origin:incoming,sha256:image.sha256});changed=true;
    }
    if(changed){this.settings.sources=this.settings.sources||{};this.settings.sources[file.path]=records;try{await this.saveData(this.settings);}catch(e){new Notice(this.t('图片已处理，但来源记录未保存：{0}',e.message),8000);}}
  }
  sourceDetails(el,row,file,text,plan){
    const t=(message,...args)=>this.t(message,...args),record=this.sourceRecord(row,file,text);
    el.createEl('p',{text:t('当前文章引用：{0}',row.src)});
    const origin=record?.origin||(/^https?:\/\//i.test(row.src)||plan.action==='copy'?row.src:null);
    if(origin){
      el.createEl('p',{text:t(/^https?:\/\//i.test(origin)?'原图床地址：{0}':'原本地来源：{0}',origin)});
      el.createEl('p',{text:t(/^https?:\/\//i.test(origin)?'归集不会删除图床原图；来源是否可访问需另行确认。':record?.localSelected?'电脑选择的来源不由插件管理，插件不会删除原文件。':'归集保留原本地文件；之后是否仍存在以完整性检查为准。')});
    }else el.createEl('p',{text:t(record?.localSelected?'电脑选择的来源不由插件管理，插件不会删除原文件。':'没有历史来源记录；当前 MD 文件名不等于最初来源。')});
    if(record?.localSelected&&record.localFilename)el.createEl('p',{text:t('电脑选择的原文件名：{0}',record.localFilename)});
    if(record?.origin&&!/^https?:\/\//i.test(record.origin)){
      const state=el.createEl('p',{text:t('正在检查原本地来源…')});
      Promise.all(candidatePaths(record.origin,file.path).map(path=>this.app.vault.adapter.exists(path))).then(found=>state.textContent=t(found.some(Boolean)?'原本地文件仍存在':'原本地文件已缺失')).catch(()=>state.textContent=t('原本地来源状态暂时无法确认'));
    }
  }
  previewSource(row,file,plan){
    if(/^https?:\/\//i.test(row.src))return {url:row.src};
    const path=plan.local?.path||plan.recovery?.path;
    if(path){try{return {url:this.app.vault.adapter.getResourcePath(path),recovery:plan.action==='missing'};}catch{}}
    if(plan.recovery?.url)return {url:plan.recovery.url,recovery:true};
    return null;
  }
  thumbnail(body,row,file,plan,initiallyOpen){
    const t=(message,...args)=>this.t(message,...args),host=body.createEl('div');
    host.style.cssText='margin:10px 0';let started=false;
    const show=()=>{
      if(started)return;started=true;const source=this.previewSource(row,file,plan);
      if(!source){host.createEl('p',{text:t('没有可预览的图片；请恢复或重新选择来源。')});return;}
      const button=host.createEl('button');button.setAttribute('aria-label',t('点击放大图片'));
      button.style.cssText='display:flex;align-items:center;justify-content:center;width:100%;height:160px;padding:8px;border:1px solid var(--background-modifier-border);border-radius:8px;background:var(--background-secondary);cursor:zoom-in;overflow:hidden';
      const image=button.createEl('img',{attr:{alt:row.title||row.originalFilename||row.filename,referrerpolicy:'no-referrer'}});
      image.style.cssText='display:block;max-width:100%;max-height:144px;object-fit:contain';
      const caption=host.createEl('div',{text:t(source.recovery?'恢复来源预览 · 点击放大':'点击缩略图放大')});caption.style.cssText='font-size:0.8em;color:var(--text-muted);margin-top:4px';
      image.onerror=()=>{image.style.display='none';button.disabled=true;caption.textContent=t('图片暂时无法预览，请检查来源或图片格式。');};
      if(/^https?:\/\//i.test(source.url)){
        button.empty();button.createEl('span',{text:t('加载网络缩略图')});
        button.onclick=()=>{button.empty();const remote=button.createEl('img',{attr:{alt:row.title||row.filename,referrerpolicy:'no-referrer'}});remote.style.cssText=image.style.cssText;remote.onerror=()=>{remote.style.display='none';button.disabled=true;caption.textContent=t('图片暂时无法预览，请检查来源或图片格式。');};remote.src=source.url;button.onclick=()=>new ImageViewer(this,source.url,row.title||row.originalFilename||row.filename).open();};
        return;
      }
      image.src=source.url;
      button.onclick=()=>new ImageViewer(this,source.url,row.title||row.originalFilename||row.filename).open();
    };
    body.ontoggle=()=>{if(body.open)show();};if(initiallyOpen)show();
  }
  async checkIntegrity(file){
    try{if(!file||file.extension!=='md')throw new Error('请先打开 Markdown 文章');const text=await this.app.vault.read(file);await this.importRecordedSources(file,text);const rows=this.articleRows(text,file);if(!rows.length)throw new Error('没有识别到图片引用');const plan=await Promise.all(rows.map(r=>this.inspect(r,file,text)));new Integrity(this,file,text,rows,plan).open();}catch(e){new Notice(this.t(e.message),8000);}
  }
  async rememberSources(file,result,full,rows,report){
    if(!this.saveData)return;this.settings=this.settings||{};this.settings.sources=this.settings.sources||{};
    const records=this.settings.sources[file.path]||[],fresh=scan(result);
    for(let i=0;i<report.length;i++){
      const image=report[i];if(image.status==='失败'||!image.destination)continue;
      const row=rows[i];if(!row)continue;
      const after=fresh[full.findIndex(r=>r.start===row.start)],id=after&&figureId(result,after);
      const previous=records.find(r=>id&&r.figureId===id)||records.find(r=>r.destination===(image.renamedFrom||image.source)||r.destination===image.destination);
      const incoming=image.replacementSource||image.source;
      const managedSource=candidatePaths(incoming,file.path).some(path=>path.startsWith(this.folder(file)+'/'));
      const origin=incoming==='本地选择图片'?null:(!managedSource?incoming:previous?.origin);
      const next={...previous,figureId:id||previous?.figureId,destination:image.destination,origin:origin||null,localSelected:image.replacementSource?incoming==='本地选择图片':previous?.localSelected||false,localFilename:image.localFilename||previous?.localFilename,sha256:image.sha256||previous?.sha256};
      if(previous)Object.assign(previous,next);else if(next.origin||next.localSelected)records.push(next);
    }
    this.settings.sources[file.path]=records;
    try{await this.saveData(this.settings);}catch(e){new Notice(this.t('图片已处理，但来源记录未保存：{0}',e.message),8000);}
  }
  async recoverImages(file,original,rows,plans){
    const recoveryData={},captionOverrides={};
    for(let i=0;i<rows.length;i++){
      const recovery=plans[i].recovery;if(!recovery)continue;
      if(rows[i].captionSource==='手动图名')captionOverrides[rows[i].start]=rows[i].title;
      if(recovery.path){const data=await this.app.vault.adapter.readBinary(recovery.path);if(recovery.sha256&&hash(data)!==recovery.sha256)throw new Error('恢复来源与记录不一致，请手动选择图片');recoveryData[rows[i].start]={data,origin:recovery.origin};}
      else recoveryData[rows[i].start]={url:recovery.url};
    }
    return this.collect(file,original,rows,{recoveries:recoveryData,captionOverrides});
  }
  async replaceAtEditor(editor,file) {
    try {
      if(!(file instanceof TFile))throw new Error('请先打开文章');
      const original=editor.getValue(),raw=imageAtCursor(original,editor.posToOffset(editor.getCursor()));
      if(!raw)throw new Error('请把光标放在要替换的图片引用所在行；同一行有多图时放在对应图片语法内');
      if(await this.app.vault.read(file)!==original)throw new Error('文章正在保存，请稍后重试');
      const row=this.articleRows(original,file).find(x=>x.start===raw.start);
      new ReplaceImage(this,file,original,row).open();
    }catch(e){new Notice(this.t(e.message),8000);}
  }
  async preview(file) {
    if (!file || file.extension !== 'md') return new Notice(this.t('请先打开 Markdown 文章'));
    const text = await this.app.vault.read(file), rows = this.articleRows(text,file);
    await this.importRecordedSources(file,text);
    if (!rows.length) return new Notice(this.t('没有识别到图片引用'));
    const plan=await Promise.all(rows.map(row=>this.inspect(row,file,text)));
    new Preview(this,file,text,rows,plan).open();
  }
  resolve(src,file) {
    src=stripReferenceStamp(src);
    let decoded; try { decoded = decodeURIComponent(src); } catch { decoded = src; }
    for(const candidate of candidatePaths(src,file.path)){const direct=this.app.vault.getAbstractFileByPath(normalizePath(candidate));if(direct instanceof TFile)return direct;}
    return this.app.metadataCache.getFirstLinkpathDest(decoded,file.path);
  }
  parseVaultReference(input, sourcePath) {
    if(!input)return null;
    let basePath='';
    try{if(typeof this.app.vault.adapter?.getBasePath==='function')basePath=this.app.vault.adapter.getBasePath();}catch{}
    for(const candidate of vaultReferenceCandidates(input,basePath)) {
      for(const path of candidatePaths(candidate,sourcePath||'')) {
        const direct=this.app.vault.getAbstractFileByPath(normalizePath(path));
        if(direct instanceof TFile)return direct;
      }
    }
    let plain=String(input).trim().replace(/^!?\[\[/,'').replace(/\]\]$/,'').split('|')[0].trim();
    try{plain=decodeURIComponent(plain);}catch{}
    if(/^(https?:|file:|obsidian:)/i.test(plain))return null;
    const byLink=this.app.metadataCache.getFirstLinkpathDest(plain.replace(/\.[^./]+$/,''),sourcePath||'/');
    return byLink instanceof TFile?byLink:null;
  }
  captionKey(text,row,file) {return file.path+'::'+(figureId(text,row)||row.src);}
  articleRows(text,file,overrides={}) {
    const rows=scan(text).map(row=>{const key=this.captionKey(text,row,file),saved=this.settings?.captions?.[key];
      const title=overrides[row.start]!==undefined?overrides[row.start]:saved;
      return title!==undefined?{...row,title:title||'未命名图片',...(overrides[row.start]?.trim()?{manualCaption:overrides[row.start].trim()}:{}),captionSource:'手动图名',needsCaptionReview:false}:row;});
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
    try{await this.saveData(this.settings);}catch(e){new Notice(this.t('图片已处理，但手动图名设置未保存：{0}',e.message),8000);}
  }
  async readLog(folder) {
    if(await this.app.vault.adapter.exists(folder+'/最近归集.txt')){
      const text=await this.app.vault.adapter.read(folder+'/最近归集.txt');
      return JSON.parse(text.split('\n--- 恢复数据 ---\n')[1]);
    }
    return JSON.parse(await this.app.vault.adapter.read(folder+'/最近归集.json'));
  }
  async saveLatest(folder,log,original) {
    const latest={...log,backup:folder+'/归集前.txt',backupText:original};
    const summary=['文章图片归集记录',`文章：${log.article}`,`时间：${log.time}`,...log.images.map(r=>`${r.status}：${r.source}\n  保存为：${r.destination||'无'}\n  ${r.reason||''}`)].join('\n');
    await this.app.vault.adapter.write(latest.backup,original);
    await this.app.vault.adapter.write(folder+'/最近归集.txt',summary+'\n--- 恢复数据 ---\n'+JSON.stringify(latest,null,2));
    // Only remove plugin records after both current recovery files are readable.
    if(await this.app.vault.adapter.read(latest.backup)!==original)throw new Error('最新恢复内容校验失败');
    await this.readLog(folder);
    const entries=await this.app.vault.adapter.list(folder);
    for(const path of entries.files){const name=path.split('/').pop();
      if(/^(?:归集记录-.*\.json|归集前-.*\.snapshot|最近归集\.json)$/.test(name)){
        const file=this.app.vault.getAbstractFileByPath(path);if(file)await this.app.vault.trash(file,true);
      }
    }
    log.backup=latest.backup;
  }
  async recovery(row,file) {
    const folder=this.folder(file);let record;
    try{const log=await this.readLog(folder);record=log.images.find(r=>candidatePaths(row.src,file.path).includes(r.destination));}catch{}
    const text=await this.app.vault.read(file),saved=this.sourceRecord(row,file,text);
    for(const dest of candidatePaths(row.src,file.path))if(await this.app.vault.adapter.exists(dest))return {kind:'local',path:dest};
    for(const dest of candidatePaths(row.src,file.path)){
      const path='.trash/'+dest.split('/').slice(-2).join('/');
      if(await this.app.vault.adapter.exists(path))return {kind:'trash',path,sha256:record?.sha256||saved?.sha256,origin:saved?.origin};
    }
    const origin=saved?.origin;
    if(origin&&!/^https?:\/\//i.test(origin))for(const path of candidatePaths(origin,file.path))if(await this.app.vault.adapter.exists(path))return {kind:'local',path,sha256:saved?.sha256,origin};
    const url=origin||record?.replacementSource||record?.source;
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
    if(issues.length)throw new Error('数学格式校验未通过，正文未修改：'+issues.map(x=>this.t('第 {0} 行 [{1}] {2}',x.line,x.code,this.t(x.message))).join('；'));
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
          const recovery=options.recoveries?.[row.start];
          const force=options.force||!!recovery;
          const plan=force?null:await this.inspect(row,file,original);
          if(plan?.action==='rename'){
            if(full.filter(r=>this.resolve(r.src,file)?.path===plan.local.path).length>1)throw new Error('这张图片在文章中重复引用，请先为不同图号选择独立图片，避免改名后引用混淆');
            if(renames.some(r=>r.from===plan.local.path))throw new Error('同一图片被多处引用且命名不同，请单独处理并确认图题');
            const move={from:plan.local.path,to:plan.destination,start:row.start};renames.push(move);
            const update=referenceUpdate(original,row,referencePath(original,row,move.to),used);if(update)changed.push(update);
            report.push({source:row.src,destination:move.to,renamedFrom:move.from,status:'成功',reason:'仅改名，图片内容不重新保存'});continue;
          }
          const existing=force?null:await this.managed(row,file);
          if(existing){const update=referenceUpdate(original,row,undefined,used);if(update)changed.push(update);report.push(update?{...existing,status:'成功',reason:'仅更新引用标签，图片未重新保存'}:existing);continue;}
          let data;const source=recovery?.url||options.url||row.src;
          if(recovery?.data!==undefined)data=recovery.data;
          else if(options.data!==undefined)data=options.data;
          else if (/^https?:\/\//i.test(source)) {let res;try{res=await requestUrl({url:source,throw:false});}catch(e){throw new Error('网络请求失败，请检查网络或换用可访问的图片直链：'+e.message);}if (res.status < 200 || res.status >= 300) throw new Error(this.t('下载失败 HTTP {0}：{1}',res.status,this.t(res.status===404?'图片地址不存在':res.status===401||res.status===403?'来源需要登录或拒绝下载':'请稍后重试或重新选择来源'))); data = res.arrayBuffer; }
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
          report.push({source:row.src,replacementSource:recovery?.origin||recovery?.url||options.url||options.vaultPath||(options.data!==undefined?'本地选择图片':undefined),localFilename:options.localFilename,destination:dest,savedAt,sha256:digest,...history,status:'成功'});
        } catch(e) { report.push({source:row.src,start:row.start,status:'失败',reason:e.message}); }
      }
      if (await this.app.vault.read(file) !== original) throw new Error('处理期间文章已变化。图片已保存，正文未替换，请重新预览');
      const time = now(), id = `${time.replace(/[^0-9]/g,'')}-${Date.now()}`;
      if(!changed.length&&!overwrites.length&&report.every(row=>row.status==='跳过')) {
        const log={article:file.path,folder,time,backup:null,resultHash:hash(Buffer.from(original)),images:report};
        await this.rememberCaptions(file,original,full,rows,report,options.captionOverrides);
        await this.rememberSources(file,original,full,rows,report);
        new Notice(this.t('无需更新：{0} 张图片已归集，全部跳过。',report.length),6000);
        return log;
      }
      // Validate the complete move plan before touching filenames. Temporary names allow swaps.
      const froms=new Set(renames.map(r=>r.from)),tos=new Set();
      for(const item of overwrites)if(renames.some(r=>r.from===item.destination||r.to===item.destination))throw new Error('图片替换与改名目标冲突，请分批处理');
      for(const move of renames){
        if(tos.has(move.to))throw new Error('多个图片将改为同一文件名，请确认图名');tos.add(move.to);
        if(await this.app.vault.adapter.exists(move.to)&&!froms.has(move.to))throw new Error('改名目标已存在，已停止以保护图片：'+move.to);
        move.temp=folder+'/归集临时-'+crypto.randomBytes(8).toString('hex')+'.'+move.from.split('.').pop();
        if(await this.app.vault.adapter.exists(move.temp))throw new Error('临时改名目标已存在，请重试');
      }
      const needsBackup=changed.length||overwrites.length||renames.length;
      await this.mkdir(folder);
      const backup = `${folder}/归集前-${id}.snapshot`;let result = changed.length ? stamp(replaceSources(original,changed),time) : original;
      if (changed.length) await this.validate(result);
      if (needsBackup) await this.app.vault.adapter.write(backup,original);
      const log = {article:file.path,folder,time,backup:needsBackup?backup:null,resultHash:hash(Buffer.from(result)),images:report,renames,sourceRecordsBefore:this.settings?.sources?.[file.path]||[]};
      await this.mkdir(folder);

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
            const mapped=referenceUpdate(updated,{...fresh,...(edit.manualCaption!==undefined?{manualCaption:edit.manualCaption}:{})},edit.target||fresh.src,rebasedUsed);if(mapped)rebased.push(mapped);}
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
      if(needsBackup)await this.saveLatest(folder,log,original);
      await this.rememberCaptions(file,result,full,rows,report,options.captionOverrides);
      await this.rememberSources(file,result,full,rows,report);
      new Notice(this.t('归集完成：更新 {0} 张，跳过 {1} 张，失败 {2} 张。',report.filter(r=>r.status==='成功').length,report.filter(r=>r.status==='跳过').length,report.filter(r=>r.status==='失败').length),10000);
      return log;
    } finally { this.running = false; }
  }
  async restore(file) {
    if (!file || file.extension !== 'md') return new Notice(this.t('请先打开文章'));
    if (this.running) return new Notice(this.t('归集正在运行，请完成后再恢复'));
    this.running = true;
    try {
      const log = await this.readLog(this.folder(file));
      if (!log.backup) throw new Error('最近一次没有修改引用');
      const current = await this.app.vault.read(file);
      if (hash(Buffer.from(current)) !== log.resultHash) throw new Error('归集后文章已有其他修改，停止恢复以保护新增内容');
      const restored = stamp(log.backupText??await this.app.vault.adapter.read(log.backup),now());
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
        try{await this.saveData(this.settings);}catch(e){new Notice(this.t('文章已恢复，但图名设置未保存：{0}',e.message),8000);}
      }
      if(log.sourceRecordsBefore&&this.saveData){this.settings.sources=this.settings.sources||{};this.settings.sources[file.path]=log.sourceRecordsBefore;await this.saveData(this.settings);}
      new Notice(this.t('已恢复归集前的引用和改名；新复制的图片仍保留'));
    } catch(e) { new Notice(this.t(e.message),10000); }
    finally { this.running = false; }
  }
};
module.exports.pure = {vaultReferenceCandidates, scan, candidatePaths};
