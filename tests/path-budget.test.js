'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../core');

test('captions may contain citations and escaped brackets without truncation',()=>{
  const text='![图5-2 测试图题，[@He2022a]](a.png){#fig:a}\n![另\\]一题](b.png)';
  const rows=core.scan(text);
  assert.equal(rows.length,2);
  assert.equal(rows[0].title,'图5-2 测试图题，[@He2022a]');
  assert.equal(rows[1].title,'另\\]一题');
});

test('fitFigureName keeps the figure prefix and trims the caption to budget',()=>{
  assert.equal(core.fitFigureName('图1_研究技术路线图',30),'图1_研究技术路线图');
  const long=core.fitFigureName('图2-1_'+'丽水—椒江凹陷区域位置'.repeat(5),20);
  assert.ok(long.startsWith('图2-1_')&&long.length<=20);
  assert.ok(!/[（(][^（）()]*$/.test(long),'截短后不留悬空括号');
  assert.equal(core.fitFigureName('图3_图题',6),'图3_图题');
  assert.ok(core.fitFigureName('图4_'+'很'.repeat(80),10).startsWith('图4_'));
  assert.equal(core.fitFigureName('图4_'+'很'.repeat(80),0),'图4_'+'很'.repeat(80));
});
