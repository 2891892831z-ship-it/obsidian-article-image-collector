'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const core=require('../core');
class TFile {
  constructor(p){this.path=p;this.name=p.split('/').pop();this.basename=this.name.replace(/\.[^.]+$/,'');this.extension=p.split('.').pop();this.parent={path:p.slice(0,p.lastIndexOf('/'))||'/'};}
}
const png=Buffer.from([137,80,78,71,13,10,26,10]);
function fixture(text,paths=[],options={}) {
  const opened=[],notices=[];
  class Element {
    constructor(tag,props={}){this.tag=tag;this.children=[];this.style={};Object.assign(this,props);}
    createEl(tag,props){const el=new Element(tag,props);this.children.push(el);return el;}
    empty(){this.children=[];}setAttribute(){}
  }
  const filename=path.resolve(__dirname,'../dist/main.js'),m=new Module(filename);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
  const req=m.require.bind(m);
  m.require=id=>id==='obsidian'?{Plugin:class{},Modal:class{constructor(app){this.app=app;this.modalEl=new Element('modal');this.contentEl=new Element('content');}open(){opened.push(this);this.onOpen();}close(){}},Notice:class{constructor(message){notices.push(message);}},TFile,normalizePath:s=>s,requestUrl:async()=>{if(options.http)throw Error('offline');return {status:404};}}:req(id);
  m._compile(fs.readFileSync(filename,'utf8'),filename);
  const plugin=new m.exports(),file=new TFile('文章/稿件.md'),bins=new Map(paths.map(p=>[p,png])),docs=new Map(),folders=new Set(['文章','文章/（图件）稿件']);
  const count={read:0,write:0,rename:0,save:0};let current=text;
  plugin.settings={numbering:'sequential',captions:{}};plugin.saveData=async()=>count.save++;
  const vault={read:async()=>current,readBinary:async f=>{count.read++;return bins.get(f.path);},getFiles:()=>[...bins.keys()].filter(p=>!p.startsWith('.trash/')).map(p=>new TFile(p)),
    getAbstractFileByPath:p=>p===file.path?file:bins.has(p)||docs.has(p)?new TFile(p):null,
    adapter:{list:async folder=>({files:[...docs.keys(),...bins.keys()].filter(p=>p.slice(0,p.lastIndexOf('/'))===folder),folders:[]}),exists:async p=>bins.has(p)||docs.has(p)||folders.has(p),read:async p=>{if(!docs.has(p))throw Error('missing');return docs.get(p);},write:async(p,t)=>docs.set(p,t),readBinary:async p=>{count.read++;return bins.get(p);}},
    trash:async f=>docs.delete(f.path),
    createFolder:async p=>folders.add(p),createBinary:async(p,b)=>bins.set(p,b),modifyBinary:async(f,b)=>{count.write++;bins.set(f.path,b);},process:async(f,fn)=>{current=fn(current);}};
  plugin.app={vault,metadataCache:{getFirstLinkpathDest:()=>null},fileManager:{renameFile:async(f,dest)=>{
    if(bins.has(dest))throw Error('collision');count.rename++;const from=f.path;bins.set(dest,bins.get(from));bins.delete(from);
    if(options.linkUpdates!==false){const rows=core.scan(current).filter(r=>core.candidatePaths(r.src,file.path).includes(from)).map(r=>({...r,target:core.referencePath(current,r,dest)}));current=core.replaceSources(current,rows);
      current=current.replaceAll('[['+from+']]','[['+dest+']]');}
    if(options.concurrent&&count.rename===2)current+='\nUser change';
  }}};
  return {plugin,file,bins,docs,count,opened,notices,text:()=>current};
}

test('caption inference uses adjacent explicit captions, preserves alt text, and asks about multiple images',()=>{
  const t='![](a.png){#fig:a}\n\n**图1-1 区域位置图**\n\n![已有图题](b.png)\n图1-2 另一标题\n\n![](c.png)![](d.png)\n图1-3 组合图';
  const rows=core.scan(t);assert.equal(rows[0].title,'区域位置图');assert.equal(rows[0].captionSource,'下方图注');assert.equal(rows[1].title,'已有图题');
  assert(rows[2].needsCaptionReview);assert(rows[3].needsCaptionReview);
  assert.equal(core.scan('![图1](a.png)\n图1 区域图')[0].title,'区域图');
  assert.equal(core.scan('![](a.png)\n普通正文')[0].title,'未命名图片');
});

test('unnamed images expose the original MD filename, empty caption, syntax and line',()=>{
  const text='# Title\n\n![](../附件/原始%20照片.jpg){#fig:a}\n![原图题](a.png)';
  const rows=core.scan(text);assert.equal(rows[0].originalFilename,'原始 照片.jpg');assert.equal(rows[0].originalCaption,'');assert.equal(rows[0].originalLine,3);
  assert.equal(rows[0].originalSyntax,'![](../附件/原始%20照片.jpg)');assert.equal(rows[1].originalCaption,'原图题');
});

test('relative paths resolve against the article and never escape the vault',()=>{
  assert.deepEqual(core.candidatePaths('../附件/a%20b.png','文章/稿件.md'),['附件/a b.png']);
  assert.deepEqual(core.candidatePaths('../../outside.png','文章/稿件.md'),[]);
  const f=fixture('![](../附件/a.png)',['附件/a.png']);assert.equal(f.plugin.resolve('../附件/a.png',f.file).path,'附件/a.png');
});

test('link comparison recognizes Obsidian shortest paths without changing labels or prose',()=>{
  const moves=[{from:'文章/（图件）稿件/旧.png',to:'文章/（图件）稿件/新.png'}];
  const original='![图题](文章/（图件）稿件/旧.png){#fig:a}\n[[文章/（图件）稿件/旧.png]]',updated='![图题](新.png){#fig:a}\n[[新.png]]';
  assert.equal(core.canonicalizeLinks(original,'文章/稿件.md',moves),core.canonicalizeLinks(updated,'文章/稿件.md',moves,true));
  assert.notEqual(core.canonicalizeLinks(updated+'\nExtra','文章/稿件.md',moves,true),core.canonicalizeLinks(original,'文章/稿件.md',moves));
});

test('selection keeps full article numbering and persists manual names by figure ID',async()=>{
  const f=fixture('![A](附件/a.png){#fig:a}\n![B](附件/b.png){#fig:b}',['附件/a.png','附件/b.png']);
  const rows=core.scan(f.text());const log=await f.plugin.collect(f.file,f.text(),[rows[1]],{captionOverrides:{[rows[1].start]:'手动图名'}});
  assert.equal(log.images.length,1);assert(f.bins.has('文章/（图件）稿件/图2_手动图名.png'));assert(!f.bins.has('文章/（图件）稿件/图1_A.png'));
  assert(f.text().includes('![A](附件/a.png){#fig:a}'));assert(f.text().includes('![手动图名]('));assert.equal(f.plugin.articleRows(f.text(),f.file)[1].title,'手动图名');
  const repeat=await f.plugin.collect(f.file,f.text(),[core.scan(f.text())[1]]);assert.equal(repeat.images[0].status,'跳过');
  await f.plugin.restore(f.file);assert.equal(f.plugin.settings.captions[f.file.path+'::b'],undefined);assert(f.text().includes('![B](附件/b.png)'));
});

test('manual name is remembered even when the destination already matches',async()=>{
  const dest='文章/（图件）稿件/图1_手动.png',f=fixture(`![原图题](${dest}){#fig:a}`,[dest]),row=core.scan(f.text())[0];
  const log=await f.plugin.collect(f.file,f.text(),[row],{captionOverrides:{[row.start]:'手动'}});
  assert.equal(log.images[0].status,'成功');assert(f.text().includes('![手动]('));assert.equal(f.plugin.articleRows(f.text(),f.file)[0].title,'手动');assert.equal(f.count.read,0);
});

test('latest TXT records replace old logs and restore the synchronized caption',async()=>{
  const dest='文章/（图件）稿件/图1_A.png',f=fixture(`![A](${dest}){#fig:a}`,[dest]),folder='文章/（图件）稿件';
  f.docs.set(folder+'/归集记录-old.json','{}');f.docs.set(folder+'/归集前-old.snapshot','old');
  const row=core.scan(f.text())[0];await f.plugin.collect(f.file,f.text(),[row],{captionOverrides:{[row.start]:'新图名'}});
  assert(f.docs.has(folder+'/最近归集.txt'));assert(f.docs.has(folder+'/归集前.txt'));assert(![...f.docs.keys()].some(p=>/\.json$|\.snapshot$/.test(p)));
  assert(f.docs.get(folder+'/最近归集.txt').includes('文章图片归集记录'));await f.plugin.restore(f.file);assert(f.text().includes('![A]('));
});

test('multiple missing figure labels stay unique after a batch rename',async()=>{
  const a='文章/（图件）稿件/图1_旧A.png',b='文章/（图件）稿件/图2_旧B.png',f=fixture(`![新A](${a})\n![新B](${b})`,[a,b]);
  await f.plugin.collect(f.file,f.text(),core.scan(f.text()));const ids=[...f.text().matchAll(/#fig:(\d+)/g)].map(m=>m[1]);assert.equal(ids.length,2);assert.equal(new Set(ids).size,2);
});

test('renaming a changed caption preserves image bytes and links, and restores its old name',async()=>{
  const old='文章/（图件）稿件/图1_旧标题.png',dest='文章/（图件）稿件/图1_新标题.png';
  const f=fixture(`![新标题](${old}){#fig:stable}\n普通链接 [[${old}]]`,[old]);
  const original=f.text(),log=await f.plugin.collect(f.file,original,core.scan(original));
  assert.equal(log.renames.length,1);assert.equal(f.count.read,0);assert.equal(f.count.write,0);assert(!f.bins.has(old));assert(f.bins.has(dest));assert(f.text().includes('[['+dest+']]'));assert(f.text().includes('{#fig:stable}'));
  await f.plugin.restore(f.file);assert(f.bins.has(old));assert(!f.bins.has(dest));assert(f.text().includes('[['+old+']]'));assert.equal(f.count.write,0);
});

test('renumbering can swap existing names without overwrite or binary reads',async()=>{
  const a='文章/（图件）稿件/图1_图名.png',b='文章/（图件）稿件/图2_图名.png';
  const f=fixture(`![图名](${b}){#fig:first}\n![图名](${a}){#fig:second}`,[a,b]);f.bins.set(a,Buffer.from('A'));f.bins.set(b,Buffer.from('B'));
  await f.plugin.collect(f.file,f.text(),core.scan(f.text()));assert.equal(f.bins.get(a).toString(),'B');assert.equal(f.bins.get(b).toString(),'A');assert.equal(f.count.read,0);assert.equal(f.count.write,0);
  await f.plugin.restore(f.file);assert.equal(f.bins.get(a).toString(),'A');assert.equal(f.bins.get(b).toString(),'B');
});

test('renaming also works when Obsidian automatic link updates are disabled',async()=>{
  const old='文章/（图件）稿件/图1_旧.png',f=fixture(`![新](${old}){#fig:a}`,[old],{linkUpdates:false});
  await f.plugin.collect(f.file,f.text(),core.scan(f.text()));assert(f.text().includes('图1_新.png'));await f.plugin.restore(f.file);assert(f.bins.has(old));
});

test('repeated references are not renamed into conflicting figure names',async()=>{
  const old='文章/（图件）稿件/图1_旧.png',f=fixture(`![A](${old}){#fig:a}\n![B](${old}){#fig:b}`,[old]);
  const log=await f.plugin.collect(f.file,f.text(),core.scan(f.text()));assert(log.images.every(r=>r.status==='失败'));assert.equal(f.count.rename,0);assert(f.bins.has(old));
});

test('rename collisions and concurrent prose edits are blocked and rolled back',async()=>{
  const old='文章/（图件）稿件/图1_旧.png',dest='文章/（图件）稿件/图1_新.png';
  const collision=fixture(`![新](${old}){#fig:a}`,[old,dest]);await assert.rejects(collision.plugin.collect(collision.file,collision.text(),core.scan(collision.text())),/目标已存在/);assert.equal(collision.count.rename,0);
  const f=fixture(`![新](${old}){#fig:a}`,[old],{concurrent:true});await assert.rejects(f.plugin.collect(f.file,f.text(),core.scan(f.text())),/文章发生了其他修改/);assert(f.bins.has(old));assert(!f.bins.has(dest));assert(f.text().includes('User change'));
});

test('missing-image diagnosis finds trash and known source, but never restores without a click',async()=>{
  const dest='文章/（图件）稿件/图1_A.png',trash='.trash/（图件）稿件/图1_A.png',f=fixture(`![A](${dest}){#fig:a}`,[trash]);
  let plan=await f.plugin.inspect(f.plugin.articleRows(f.text(),f.file)[0],f.file,f.text());assert.equal(plan.action,'missing');assert.equal(plan.recovery.kind,'trash');assert(!f.bins.has(dest));
  f.bins.delete(trash);f.docs.set('文章/（图件）稿件/最近归集.json',JSON.stringify({images:[{destination:dest,source:'https://example.com/a.png'}]}));
  plan=await f.plugin.inspect(f.plugin.articleRows(f.text(),f.file)[0],f.file,f.text());assert.equal(plan.recovery.url,'https://example.com/a.png');
  const moved=fixture('![A](old/a.png){#fig:a}',['new/a.png']);plan=await moved.plugin.inspect(moved.plugin.articleRows(moved.text(),moved.file)[0],moved.file,moved.text());assert.equal(plan.recovery.kind,'local');
});

test('trash recovery button restores only the clicked image and preserves its figure ID',async()=>{
  const dest='文章/（图件）稿件/图1_A.png',trash='.trash/（图件）稿件/图1_A.png',f=fixture(`![A](${dest}){#fig:a}`,[trash]);await f.plugin.preview(f.file);
  const all=el=>[el,...el.children.flatMap(all)],button=all(f.opened[0].contentEl).find(e=>e.text==='从库内回收站恢复');assert(button);await button.onclick();
  assert(f.bins.has(dest));assert(f.bins.has(trash));assert(f.text().includes('{#fig:a}'));assert.deepEqual(f.bins.get(dest),png);
});

test('preview exposes checkboxes, editable names, reasons and selected-only execution',async()=>{
  const f=fixture('![A](附件/a.png){#fig:a}\n![](附件/b.png){#fig:b}',['附件/a.png','附件/b.png']);await f.plugin.preview(f.file);const modal=f.opened[0];
  const all=el=>[el,...el.children.flatMap(all)],els=all(modal.contentEl),checks=els.filter(e=>e.type==='checkbox');assert.equal(checks.length,2);assert(checks[0].checked);assert(checks[1].checked);
  assert(els.some(e=>e.type==='text'));checks[1].checked=false;checks[1].onchange();const button=els.find(e=>e.text==='处理勾选图片');await button.onclick();assert(f.bins.has('文章/（图件）稿件/图1_A.png'));assert(!f.bins.has('文章/（图件）稿件/图2_未命名图片.png'));
});

test('network failures show explicit retry guidance without changing the article',async()=>{
  const f=fixture('![A](https://example.com/a.png){#fig:a}',[],{http:true}),original=f.text();const log=await f.plugin.collect(f.file,original,core.scan(original));assert.equal(log.images[0].status,'失败');assert.match(log.images[0].reason,/网络请求失败/);assert.equal(f.text(),original);
});
