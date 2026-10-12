'use strict';
const EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|tiff?)$/i;
function stripReferenceStamp(src) {return src.replace(/#v=\d{8}-\d{6}(?:-\d{3})?(?:-[a-f0-9]{6})?$/,'');}
function safeName(title) {
  let name = title.replace(/<[^>]*>/g, '').replace(/==|\*\*|__/g, '').replace(/&amp;/g, '&')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 100).replace(/[. ]+$/g, '') || '图片';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name;
}
function scan(text) {
  // Mask non-rendered examples without changing character offsets.
  text = text.replace(/<!--[\s\S]*?-->|%%[\s\S]*?%%/g, s => s.replace(/[^\r\n]/g,' '));
  const rows = []; let fenced = null, offset = 0;
  for (const line of text.split(/(?<=\n)/)) {
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) { if (!fenced) fenced = fence[1]; else if (fence[1][0] === fenced[0] && fence[1].length >= fenced.length) fenced = null; offset += line.length; continue; }
    if (!fenced) {
      const masked = line.replace(/(`+)([^\n]*?)\1/g, s => ' '.repeat(s.length));
      const re = /!\[\[([^\]\n]+)\]\]|!\[([^\]\n]*)\]\(/g; let m;
      while ((m = re.exec(masked))) {
        if (m.index && line[m.index-1] === '\\') continue;
        if (m[1]) {
          const parts = m[1].split('|'), src = parts[0];
          if (EXT.test(stripReferenceStamp(src))) rows.push({begin:offset+m.index,finish:offset+m.index+m[0].length,start: offset + m.index + 3, end: offset + m.index + 3 + src.length, src, title: stripReferenceStamp(src).split('/').pop().replace(EXT, '').replace(/_\d{8}-\d{6}(?:-\d+)?$/,'')});
        } else {
          const start = re.lastIndex; let i = start, depth = 1;
          for (; i < line.length; i++) { if (line[i] === '\\') { i++; continue; } if (line[i] === '(') depth++; if (line[i] === ')' && --depth === 0) break; }
          if (depth !== 0) continue;
          const raw = line.slice(start, i), metadata=/\s+(["'])(.*?)\1\s*$/.exec(raw);
          const destination=metadata?raw.slice(0,metadata.index):raw;
          let src=destination,leading=0;
          if(destination.startsWith('<')&&destination.endsWith('>')){src=destination.slice(1,-1);leading=1;}
          if (/^https?:\/\//i.test(src) || EXT.test(stripReferenceStamp(src))) rows.push({begin:offset+m.index,finish:offset+i+1,start: offset + start + leading, end: offset + start+destination.length-leading,referenceStart:offset+start,referenceEnd:offset+i,referenceTitle:metadata?.[2]||'',src, title: m[2]});
          re.lastIndex = i + 1;
        }
      }
    }
    offset += line.length;
  }
  return inferCaptions(text,rows);
}
function captionText(line) {
  const clean=line.replace(/<[^>]*>/g,'').replace(/==|\*\*|__/g,'').replace(/\{[^}]*\}/g,'').trim();
  const match=/^(?:图\s*\d+(?:[-.－–]\d+)?|Fig(?:ure)?\.?\s*\d+(?:[-.]\d+)?)\s*[、:：.．_-]?\s+(.+)$/i.exec(clean)
    ||/^图\s*\d+(?:[-.－–]\d+)?[、:：.．_-]?\s*([^\d\s].*)$/.exec(clean);
  return match?match[1].trim():null;
}
function inferCaptions(text,rows) {
  return rows.map(row=>{
    const wiki=text.slice(row.begin,row.begin+3)==='![[';
    let decoded;try{decoded=decodeURIComponent(stripReferenceStamp(row.src));}catch{decoded=row.src;}
    const originalFilename=decoded.split(/[\\/]/).pop().split(/[?#]/)[0];
    row={...row,originalFilename,originalCaption:wiki?'':row.title,originalSyntax:text.slice(row.begin,row.finish),originalLine:text.slice(0,row.begin).split('\n').length};
    const meaningful=!wiki&&row.title.trim()&&!/^图\s*\d+(?:[-.]\d+)?$/.test(row.title.trim());
    if(meaningful)return {...row,captionSource:'图片图题',needsCaptionReview:false};
    const lineStart=text.lastIndexOf('\n',row.begin-1)+1;
    const lineEnd=text.indexOf('\n',row.finish),end=lineEnd<0?text.length:lineEnd;
    const peers=rows.filter(r=>r.begin>=lineStart&&r.begin<=end);
    const candidates=[];
    for(const direction of ['after','before']) {
      const lines=direction==='after'?text.slice(end+1).split(/\r?\n/).slice(0,4):text.slice(0,lineStart).split(/\r?\n/).reverse().slice(0,4);
      for(const line of lines){if(!line.trim()||/^\s*\{[^}]*\}\s*$/.test(line))continue;
        const caption=captionText(line);if(caption)candidates.push({caption,direction});break;}
    }
    const unique=[...new Set(candidates.map(c=>c.caption))];
    if(unique.length===1&&peers.length===1)return {...row,title:unique[0],captionSource:candidates[0].direction==='after'?'下方图注':'上方图注',needsCaptionReview:false};
    const fallback=wiki?row.title:'未命名图片';
    return {...row,title:fallback,captionSource:unique.length?'相邻图注待确认':wiki?'原文件名':'缺少图题',needsCaptionReview:unique.length>0||!wiki,captionCandidates:unique};
  });
}
function figureId(text,row) {
  const suffix=/^[ \t]*(?:\r?\n[ \t]*)?\{([^}\r\n]*)\}/.exec(text.slice(row.finish));
  return suffix?/(?:^|\s)#fig:([^\s}]+)/.exec(suffix[1])?.[1]||null:null;
}
function referencePath(text,row,dest) {
  return text.slice(row.begin,row.begin+3)==='![['?dest:dest.replace(/[% ()#?\[\]<>]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
}
function candidatePaths(src,notePath) {
  let decoded;try{decoded=decodeURIComponent(stripReferenceStamp(src));}catch{decoded=stripReferenceStamp(src);}
  if(/^(?:[a-z]+:|\\\\)/i.test(decoded))return [];
  const clean=s=>{const result=[];for(const part of s.replace(/\\/g,'/').split('/')){if(!part||part==='.')continue;if(part==='..'){if(!result.length)return null;result.pop();}else result.push(part);}return result.join('/');};
  const parent=notePath.includes('/')?notePath.slice(0,notePath.lastIndexOf('/')):'';
  const relative=clean(parent+'/'+decoded),root=clean(decoded);
  return [...new Set((/^\.\.?\//.test(decoded)?[relative,root]:[root,relative]).filter(Boolean))];
}
function canonicalizeLinks(text,notePath,moves,after=false) {
  const map=new Map();for(const move of moves)map.set(after?move.to:move.from,move.from);
  const canonical=src=>{for(const p of candidatePaths(src,notePath))if(map.has(p))return map.get(p);
    let decoded;try{decoded=decodeURIComponent(src);}catch{decoded=src;}
    if(!decoded.includes('/')){const matches=[...map].filter(([p])=>p.split('/').pop()===decoded);if(matches.length===1)return matches[0][1];}
    return src;};
  // Compare only link changes caused by our moves; caption, label and prose edits still fail the concurrency check.
  const edits=scan(text).map(row=>({...row,target:canonical(row.src)}));
  let result=replaceSources(text,edits);
  result=result.replace(/(?<!!)\[\[([^\]\n|]+)(\|[^\]\n]*)?\]\]/g,(_,src,alias)=>`[[${canonical(src)}${alias||''}]]`);
  result=result.replace(/(?<!!)(\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s\n]+)(\s+["'][^\n]*?["'])?(\))/g,(_,prefix,src,title,end)=>{
    const angle=src.startsWith('<'),raw=angle?src.slice(1,-1):src,next=canonical(raw);
    return prefix+(angle?'<'+next+'>':next)+(title||'')+end;
  });
  return result;
}
function imageType(buffer) {
  const b = new Uint8Array(buffer), ascii = (a,z) => String.fromCharCode(...b.slice(a,z));
  if (b.length >= 8 && b[0] === 137 && ascii(1,4) === 'PNG') return 'png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'jpg';
  if (/^GIF8[79]a$/.test(ascii(0,6))) return 'gif';
  if (ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP') return 'webp';
  if (ascii(0,2) === 'BM') return 'bmp';
  if (ascii(0,4) === 'II*\x00' || ascii(0,4) === 'MM\x00*') return 'tif';
  if (ascii(4,8) === 'ftyp' && /avif|avis/.test(ascii(8,32))) return 'avif';
  const s = new TextDecoder().decode(b.slice(0,4096)).trim();
  if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(s)) return 'svg';
  throw new Error('文件不是已支持的图片，未替换引用');
}
function replaceSources(text, rows) {
  const edits=[];
  for(const row of rows) {
    if(row.captionTarget!==undefined)edits.push({start:row.captionStart,end:row.captionEnd,text:row.captionTarget});
    if(row.suffixTarget!==undefined)edits.push({start:row.finish,end:row.suffixEnd,text:row.suffixTarget});
    if(row.target!==undefined)edits.push({start:row.referenceTarget!==undefined?row.referenceStart:row.start,end:row.referenceTarget!==undefined?row.referenceEnd:row.end,text:row.referenceTarget??row.target});
  }
  for(const edit of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,edit.start)+edit.text+text.slice(edit.end);
  return text;
}
function referenceUpdate(text,row,destination,used,clock=new Date()) {
  const update={...row};
  if(row.manualCaption!==undefined&&text.slice(row.begin,row.begin+3)!=='![['){
    update.captionStart=row.begin+2;update.captionEnd=text.indexOf('](',row.begin);
    update.captionTarget=row.manualCaption.replace(/\\/g,'\\\\').replace(/\]/g,'\\]');
    if(text.slice(update.captionStart,update.captionEnd)===update.captionTarget)delete update.captionTarget;
  }
  const src=stripReferenceStamp(destination||row.src);
  if(src!==row.src)update.target=src;
  const title=(row.referenceTitle||'').replace(/(?:\s*\|\s*)?v=\d{8}-\d{6}(?:-\d{3})?(?:-[a-f0-9]{6})?$/,'').trim();
  if(row.referenceStart!==undefined && (src!==row.src||title!==row.referenceTitle)) {
    update.target=src;
    update.referenceTarget=(text[row.referenceStart]==='<'?`<${src}>`:src)+(title?` "${title.replace(/"/g,'&quot;')}"`:'');
  }
  const suffix=/^[ \t]*(?:\r?\n[ \t]*)?\{([^}\r\n]*)\}/.exec(text.slice(row.finish));
  if(!suffix || !/(?:^|\s)#fig:[^\s}]+/.test(suffix[1])) {
    const p=n=>String(n).padStart(2,'0');
    let date=new Date(clock),id;
    do {id=`${date.getFullYear()}${p(date.getMonth()+1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;date=new Date(date.getTime()+1000);}while(used.has(id));
    used.add(id);
    update.suffixEnd=row.finish+(suffix?suffix[0].length:0);
    update.suffixTarget=suffix?suffix[0].replace('{',`{#fig:${id} `):`{#fig:${id}}`;
  }
  return update.target!==undefined||update.suffixTarget!==undefined||update.captionTarget!==undefined?update:null;
}
function chapterNumber(value) {
  value=value.replace(/\s/g,'').replace(/[０-９]/g,c=>String(c.charCodeAt(0)-0xff10));
  if(/^\d+$/.test(value))return Number(value)>0?String(Number(value)):null;
  const digits={'零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9},units={'十':10,'百':100,'千':1000};
  if(!/^[零〇一二两三四五六七八九十百千]+$/.test(value))return null;
  let result=0,digit=0;
  if(!/[十百千]/.test(value))result=Number([...value].map(c=>digits[c]).join(''));
  else {for(const c of value){if(units[c]){result+=(digit||1)*units[c];digit=0;}else digit=digits[c];}result+=digit;}
  return result>0?String(result):null;
}
function numberFigures(text, rows, mode='auto') {
  const fm=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  let masked=text.replace(/<!--[\s\S]*?-->|%%[\s\S]*?%%/g,s=>s.replace(/[^\r\n]/g,' '));
  if(fm)masked=fm[0].replace(/[^\r\n]/g,' ')+masked.slice(fm[0].length);
  const headings=[];let offset=0,fenced=null;
  for(const line of masked.split(/(?<=\n)/)) {
    const fence=/^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if(fence){if(!fenced)fenced=fence[1];else if(fence[1][0]===fenced[0]&&fence[1].length>=fenced.length)fenced=null;offset+=line.length;continue;}
    if(!fenced && /^ {0,3}#{1,6}\s+/.test(line)) {
      const cleaned=line.replace(/<[^>]*>/g,'').replace(/==|\*\*/g,'');
      const heading=/^ {0,3}(#{1,6})\s+(.+?)\s*$/.exec(cleaned);
      if(heading){
        const title=heading[2],explicit=/^第\s*([0-9０-９零〇一二两三四五六七八九十百千\s]+)\s*章/.exec(title)||/^([零〇一二两三四五六七八九十百千]+)[、.．]\s*\S/.exec(title);
        const numeric=/^([0-9０-９]+)(?:[、.．](?![0-9０-９])|\s+)\s*\S/.exec(title);
        headings.push({offset,level:heading[1].length,explicit:explicit?chapterNumber(explicit[1]):null,numeric:numeric?chapterNumber(numeric[1]):null});
      }
    }
    offset+=line.length;
  }
  const hasExplicit=headings.some(h=>h.explicit);
  const numericLevel=Math.min(...headings.filter(h=>h.numeric).map(h=>h.level));
  for(const h of headings)h.chapter=hasExplicit?h.explicit:(h.level===numericLevel?h.numeric:null);
  const chapterMode=mode==='chapter'||(mode==='auto'&&/^chapters:\s*true\s*$/m.test(fm?.[1]||'')&&headings.some(h=>h.chapter));
  const counts=new Map();let index=0,heading=-1,chapter=null,chapterLevel=0;
  return rows.map(row=>{
    while(heading+1<headings.length&&headings[heading+1].offset<row.start){
      const h=headings[++heading];
      if(h.chapter){chapter=h.chapter;chapterLevel=h.level;}
      else if(h.level<=chapterLevel&&!h.numeric){chapter=null;chapterLevel=0;}
    }
    let number=String(++index),warning='';
    if(chapterMode) {
      if(chapter){const n=(counts.get(chapter)||0)+1;counts.set(chapter,n);number=`${chapter}-${n}`;}
      else {number=`未分章-${index}`;warning='未识别到所属章节，请使用“第1章”“一、标题”或顶层“1 标题”等编号标题';}
    }
    const caption=safeName(row.title).replace(/^图\s*\d+(?:[-.－–]\d+)?[\s_、:：]+/,'').replace(/^图未分章-\d+_/,'')||'未命名图片';
    const filename=`图${number}_${caption}`;
    return {...row,number,filename,chapter:chapterMode?chapter:null,numbering:chapterMode?'chapter':'sequential',warning};
  });
}
function imageAtCursor(text,offset) {
  const rows=scan(text),exact=rows.find(row=>offset>=row.begin&&offset<=row.finish);
  if(exact)return exact;
  const start=text.lastIndexOf('\n',Math.max(0,offset-1))+1,end=text.indexOf('\n',offset);
  const line=rows.filter(row=>row.begin>=start&&row.begin<(end<0?text.length:end));
  return line.length===1?line[0]:null;
}
function matchesImageStem(stem,base) {
  if(stem===base)return true;
  if(stem.startsWith(base+'_') && /^\d{8}-\d{6}(?:-[2-9]\d*|-1\d+)?$/.test(stem.slice(base.length+1)))return true;
  if(stem.startsWith(base+'-') && /^\d+$/.test(stem.slice(base.length+1)) && Number(stem.slice(base.length+1))>=2)return true;
  return false;
}
function stamp(text, time) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (!/^---\r?\n/.test(text)) return `---${eol}date modified: ${time}${eol}---${eol}${text}`;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/.exec(text);
  if (!match) throw new Error('frontmatter 未闭合');
  let fm = match[1];
  if (/^(date modified|date-modified|modified|last-modified):/m.test(fm)) fm = fm.replace(/^(date modified|date-modified|modified|last-modified):[^\r\n]*/gm, (_,k) => `${k}: ${time}`);
  else fm += `${eol}date modified: ${time}`;
  return `---${eol}${fm}${eol}---` + text.slice(match[0].length);
}
function validateMarkdownMath(text) {
  const lines=text.split(/\r\n|\n|\r/),issues=[];
  let fence=null,fenceLine=0,math=false,mathLine=0,closed=0;
  const issue=(line,code,message)=>issues.push({line,code,message});
  for(let i=0;i<lines.length;i++) {
    const line=lines[i],n=i+1;
    if(fence) {if(new RegExp('^ {0,3}'+fence[0]+'{'+fence.length+',}[ \\t]*$').test(line))fence=null;continue;}
    const opening=/^ {0,3}(`{3,}|~{3,})/.exec(line);
    if(!math&&opening){fence=opening[1];fenceLine=n;continue;}
    if(math&&/^ {0,3}#{1,6}(?:[ \t]+|$)/.test(line))issue(n,'MATH003','标题位于未闭合的数学块中');
    const checked=line.replace(/(`+).*?\1/g,''),delimiter=/^\s*\$\$\s*$/.test(checked);
    if(checked.includes('$$')&&!delimiter)issue(n,'MATH001','行间 $$ 必须独占一行');
    const label=/^\s*\{#eq:[^{}\s]+\}\s*$/.test(checked);
    if(/\{#eq:[^}]+\}/.test(checked)&&!label)issue(n,'MATH004','公式标签必须独占一行');
    if(label){if(!closed||closed!==n-1)issue(n,'MATH004','公式标签必须紧跟结束 $$ 行');if(i+1>=lines.length||lines[i+1].trim())issue(n,'MATH005','公式标签后必须空一行');}
    if(delimiter){if(math){math=false;closed=n;}else{math=true;mathLine=n;closed=0;}}
  }
  if(fence)issue(fenceLine,'FENCE001','代码围栏未闭合');
  if(math)issue(mathLine,'MATH002','行间数学块未闭合');
  return issues;
}
module.exports = {scan, safeName, imageType, replaceSources, referenceUpdate, stamp, numberFigures, imageAtCursor, matchesImageStem, stripReferenceStamp, validateMarkdownMath, figureId, referencePath, candidatePaths, canonicalizeLinks};
