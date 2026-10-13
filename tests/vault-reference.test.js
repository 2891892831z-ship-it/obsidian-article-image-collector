'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../core');

const ROOT='C:\\Users\\wanxi\\Desktop\\长大\\OB知识宝库';

test('vault-relative paths pass through unchanged',()=>{
  assert.deepEqual(core.vaultReferenceCandidates('4-成果/丽水-椒江构造小论文/图件/主断裂图.png'),
    ['4-成果/丽水-椒江构造小论文/图件/主断裂图.png']);
});

test('leading slash and backslash forms are normalized',()=>{
  assert.ok(core.vaultReferenceCandidates('/4-成果/a/b.png').includes('4-成果/a/b.png'));
  assert.ok(core.vaultReferenceCandidates('4-成果\\a\\b.png').includes('4-成果/a/b.png'));
});

test('absolute Windows paths strip the vault root when basePath matches',()=>{
  const input='C:\\Users\\wanxi\\Desktop\\长大\\OB知识宝库\\4-成果\\硕士毕业论文\\图件\\毕业论文中图\\fig_3_1_主要断裂系统平面图.png';
  const got=core.vaultReferenceCandidates(input,ROOT);
  assert.ok(got.includes('4-成果/硕士毕业论文/图件/毕业论文中图/fig_3_1_主要断裂系统平面图.png'));
});

test('wikilinks with alias and embeds are reduced to the path',()=>{
  assert.deepEqual(core.vaultReferenceCandidates('[[4-成果/x/图.png|500]]'),['4-成果/x/图.png']);
  assert.deepEqual(core.vaultReferenceCandidates('![[4-成果/x/图.png]]'),['4-成果/x/图.png']);
});

test('obsidian:// links decode the file parameter',()=>{
  assert.deepEqual(core.vaultReferenceCandidates('obsidian://open?vault=x&file=4-%E6%88%90%E6%9E%9C%2Fa.png'),['4-成果/a.png']);
  assert.deepEqual(core.vaultReferenceCandidates('obsidian://open?vault=x&file=%E5%9B%BE%20b.png'),['图 b.png']);
});

test('file:/// URLs decode into absolute path candidates',()=>{
  assert.ok(core.vaultReferenceCandidates('file:///C:/Users/wanxi/Desktop/%E9%95%BF%E5%A4%A7/OB%E7%9F%A5%E8%AF%86%E5%AE%9D%E5%BA%93/4-成果/a.png')
    .includes('C:/Users/wanxi/Desktop/长大/OB知识宝库/4-成果/a.png'));
});

test('percent-encoded relative paths decode once',()=>{
  assert.ok(core.vaultReferenceCandidates('4-成果/My%20Image%20%E5%9B%BE.png').includes('4-成果/My Image 图.png'));
});

test('remote URLs and empty input yield no candidates',()=>{
  assert.deepEqual(core.vaultReferenceCandidates('https://erism.oss-cn-hangzhou.aliyuncs.com/z/x.png'),[]);
  assert.deepEqual(core.vaultReferenceCandidates('   '),[]);
});
