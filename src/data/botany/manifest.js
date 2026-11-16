// 知识库来源声明与分片清单 —— 课程助教问答的唯一权威依据
export const BOTANY_SOURCE = {
  title: '植物学（第三版）',
  short: '《植物学（第三版）》',
  editor: '金银根 主编',
  publisher: '科学出版社',
  edition: '全彩版 · 普通高等教育“十三五”规划教材',
  pages: 356,
  note: '本知识库全部问答依据均由该教材 OCR 全文检索得到，回答附章节与教材页码，可回查原书。'
};
export const BOTANY_CHAPTERS = [
  {
    "id": "ch00",
    "name": "绪论",
    "file": "./ch00.js",
    "chunks": 77
  },
  {
    "id": "ch01",
    "name": "第一章　植物界基本类群与分类",
    "file": "./ch01.js",
    "chunks": 174
  },
  {
    "id": "ch02",
    "name": "第二章　植物细胞与组织",
    "file": "./ch02.js",
    "chunks": 114
  },
  {
    "id": "ch03",
    "name": "第三章　被子植物营养器官的形态、结构与功能",
    "file": "./ch03.js",
    "chunks": 168
  },
  {
    "id": "ch04",
    "name": "第四章　被子植物生殖器官的形态、结构与功能",
    "file": "./ch04.js",
    "chunks": 166
  },
  {
    "id": "ch05",
    "name": "第五章　被子植物主要分科概述",
    "file": "./ch05.js",
    "chunks": 206
  }
];
export const CORPUS_STATS = { chunks: 905, chars: 321048, parts: 32 };
