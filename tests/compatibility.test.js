'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const core=require('../core');

test('Chinese chapters, mixed heading levels and Arabic subheadings keep chapter numbering',()=>{
  const text='# 文档标题\n# 一、背景\n![a](a.png)\n# 三、工作基础\n## 1.研究现状\n![b](b.png)\n### （1）小节\n![c](c.png)\n## 四、研究内容\n## 1.目标\n![d](d.png)\n# 十一、团队\n![e](e.png)\n# 参考文献\n![f](f.png)';
  const rows=core.numberFigures(text,core.scan(text),'chapter');
  assert.deepEqual(rows.map(r=>r.number),['1-1','3-1','3-2','4-1','11-1','未分章-6']);
});

test('第N章 accepts Chinese and full-width numbers and wrapper headings',()=>{
  const text='---\nchapters: true\n---\n# 标题\n## **第十二章 内容**\n![a](a.png)\n### 子标题\n![b](b.png)\n## 第１３章 内容\n![c](c.png)';
  assert.deepEqual(core.numberFigures(text,core.scan(text)).map(r=>r.number),['12-1','12-2','13-1']);
});

test('Arabic numbered chapter headings use the shallowest numbered level',()=>{
  const text='# 标题\n## 1 引言\n![a](a.png)\n### 1. 小节\n![b](b.png)\n## 2、方法\n![c](c.png)\n## 3.结果\n![d](d.png)';
  assert.deepEqual(core.numberFigures(text,core.scan(text),'chapter').map(r=>r.number),['1-1','1-2','2-1','3-1']);
});

test('chapter scanning ignores frontmatter, code and comments; sequential mode is unchanged',()=>{
  const text='---\nchapters: true\n---\n```md\n# 第9章 示例\n```\n<!--\n# 第8章 注释\n-->\n# 一、正文\n![a](a.png)\n# 二、正文\n![b](b.png)';
  assert.deepEqual(core.numberFigures(text,core.scan(text)).map(r=>r.number),['1-1','2-1']);
  assert.deepEqual(core.numberFigures(text,core.scan(text),'sequential').map(r=>r.number),['1','2']);
});

test('math validation accepts LF and CRLF with labels and ignores code examples',()=>{
  const good='# Title\n\n$$\nx^2\n$$\n{#eq:one}\n\nText\n\n```markdown\n$$ inline $$\n```\n';
  assert.deepEqual(core.validateMarkdownMath(good),[]);
  assert.deepEqual(core.validateMarkdownMath(good.replace(/\n/g,'\r\n')),[]);
  assert.deepEqual(core.validateMarkdownMath('`$$ example $$`\n'),[]);
});

test('math validation rejects malformed delimiters, labels, headings, and fences',()=>{
  for(const [text,code] of [
    ['$$ x $$','MATH001'],['$$\nx','MATH002'],['$$\n# Heading\n$$','MATH003'],
    ['{#eq:one}\n\n','MATH004'],['$$\nx\n$$\n{#eq:one}\nText','MATH005'],
    ['```\ntext','FENCE001'],['$$\nx\n$$\n\n{#eq:one}\n\n','MATH004']
  ])assert(core.validateMarkdownMath(text).some(x=>x.code===code),text);
});

test('replacing images keeps figure labels, width, captions and references',()=>{
  const text='![中文图题](old.png){#fig:stable width=80%}\nSee @fig:stable';
  const row=core.scan(text)[0];
  assert.equal(core.replaceSources(text,[core.referenceUpdate(text,row,'folder/图1_中文图题.png',new Set())]),
    '![中文图题](folder/图1_中文图题.png){#fig:stable width=80%}\nSee @fig:stable');
});

test('new image labels are unique and never add filename timestamps',()=>{
  const text='![A](a.png){width=50%}\n![[b.png|300]]',used=new Set();
  const updates=core.scan(text).map(row=>core.referenceUpdate(text,row,undefined,used,new Date(2026,0,1,0,0,0)));
  const result=core.replaceSources(text,updates);
  assert.equal(used.size,2);
  assert(result.includes('![A](a.png){#fig:20260101000000 width=50%}'));
  assert(result.includes('![[b.png|300]]{#fig:20260101000001}'));
});

test('desktop plugin validates without shell, PowerShell, or vault scripts',async()=>{
  const filename=path.resolve(__dirname,'../dist/main.js'),source=fs.readFileSync(filename,'utf8');
  assert(!/powershell|child_process|execFile/.test(source));
  const module=new Module(filename);module.filename=filename;module.paths=Module._nodeModulePaths(path.dirname(filename));
  const originalRequire=module.require.bind(module);
  module.require=id=>id==='obsidian'?{Plugin:class{},Modal:class{},Notice:class{},TFile:class{},normalizePath:s=>s}:originalRequire(id);
  module._compile(source,filename);
  const plugin=new module.exports();
  await plugin.validate('$$\nx^2\n$$\n{#eq:test}\n\n');
  await assert.rejects(plugin.validate('$$ x $$'),/MATH001/);
  await assert.rejects(plugin.validate('CO\u2082'),/Unicode/);
  assert.equal(plugin.folder({parent:{path:'论文'},basename:'中文文章'}),'论文/（图件）中文文章');
});

test('24 managed images are skipped; one replacement and restore touch only that image',async()=>{
  class TFile {
    constructor(filePath){this.path=filePath;this.basename=filePath.split('/').pop().replace(/\.[^.]+$/,'');this.extension=filePath.split('.').pop();this.parent={path:filePath.slice(0,filePath.lastIndexOf('/'))};}
  }
  const filename=path.resolve(__dirname,'../dist/main.js'),module=new Module(filename);
  module.filename=filename;module.paths=Module._nodeModulePaths(path.dirname(filename));
  const originalRequire=module.require.bind(module);
  module.require=id=>id==='obsidian'?{Plugin:class{},Modal:class{},Notice:class{},TFile,normalizePath:s=>s}:originalRequire(id);
  module._compile(fs.readFileSync(filename,'utf8'),filename);
  const plugin=new module.exports(),file=new TFile('文章/测试.md'),folder=plugin.folder(file);
  const oldImage=Buffer.from([137,80,78,71,13,10,26,10]),newImage=Buffer.concat([oldImage,Buffer.from('new')]);
  let text=Array.from({length:24},(_,i)=>`![caption${i+1}](${folder}/图${i+1}_caption${i+1}.png){#fig:id${i+1}}`).join('\n');
  const binaries=new Map(Array.from({length:24},(_,i)=>[`${folder}/图${i+1}_caption${i+1}.png`,oldImage]));
  const documents=new Map(),folders=new Set([folder]);let reads=0,writes=0;
  plugin.app={vault:{read:async()=>text,readBinary:async f=>{reads++;return binaries.get(f.path);},
    getAbstractFileByPath:p=>binaries.has(p)?new TFile(p):null,
    adapter:{list:async()=>({files:[...documents.keys()],folders:[]}),exists:async p=>folders.has(p)||binaries.has(p)||documents.has(p),
      read:async p=>documents.get(p),write:async(p,t)=>documents.set(p,t),readBinary:async p=>{reads++;return binaries.get(p);}},
    createFolder:async p=>folders.add(p),createBinary:async(p,b)=>binaries.set(p,b),
    modifyBinary:async(f,b)=>{writes++;binaries.set(f.path,b);},process:async(f,fn)=>{text=fn(text);}},
    metadataCache:{getFirstLinkpathDest:()=>null}};
  const first=await plugin.collect(file,text,core.scan(text));
  assert.equal(first.images.filter(x=>x.status==='跳过').length,24);assert.equal(reads,0);assert.equal(writes,0);
  const original=text,secondRow=core.scan(text)[1];
  const second=await plugin.collect(file,text,core.scan(text),{onlyStart:secondRow.start,force:true,data:newImage});
  assert.equal(second.images.length,1);assert.equal(writes,1);assert.equal(text,original);assert(second.backup);
  assert.deepEqual(binaries.get(`${folder}/图2_caption2.png`),newImage);
  await plugin.restore(file);
  assert.equal(writes,2);assert.deepEqual(binaries.get(`${folder}/图2_caption2.png`),oldImage);
  assert(text.includes('{#fig:id2}'));assert(!text.includes('v='));
});
