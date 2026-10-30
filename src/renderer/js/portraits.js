// 半身頭像：英雄（男 20）、佳人（女 20）、AI 軍師（男女各 15）
import { $$, h, modal, ASSETS } from './util.js';

const BASE = ASSETS + 'portraits/';
let list = [];
let byId = new Map();

export async function loadPortraits() {
  const r = await fetch(BASE + 'portraits.json');
  list = await r.json();
  byId = new Map(list.map((p) => [p.id, p]));
  return list;
}

export const portraitUrl = (id) => BASE + (byId.has(id) ? id : 'm01') + '.svg';
export const portraitOf = (id) => byId.get(id) || null;
export const players = () => list.filter((p) => p.group !== 'advisor');
export const advisors = () => list.filter((p) => p.group === 'advisor');
export const labelOf = (id) => (byId.get(id) ? byId.get(id).label : '');
export const validProfile = (pr) => !!(pr && byId.get(pr.avatar) && byId.get(pr.avatar).group !== 'advisor' && byId.get(pr.advisor) && byId.get(pr.advisor).group === 'advisor');

// 隨機挑選（避開已用的）
export function randomProfile(avoid = []) {
  const pick = (arr) => { const a = arr.filter((p) => !avoid.includes(p.id)); const s = a.length ? a : arr; return s[Math.floor(Math.random() * s.length)].id; };
  return { avatar: pick(players()), advisor: pick(advisors()) };
}

// 選擇頭像與軍師（required：必須選好才能關閉）
export function pickProfile(current, { required = false } = {}) {
  const sel = { avatar: current && current.avatar, advisor: current && current.advisor };
  const grid = (items, key) => h('div', { class: 'pf-grid' }, items.map((p) => h('button', {
    class: 'pf-item' + (sel[key] === p.id ? ' on' : ''), 'data-id': p.id, 'data-key': key, title: p.label,
    onclick: (e) => {
      sel[key] = p.id;
      $$(`.pf-item[data-key="${key}"]`).forEach((b) => b.classList.toggle('on', b.dataset.id === p.id));
      refresh();
    },
  }, h('img', { src: portraitUrl(p.id), alt: p.label, loading: 'lazy' }), h('span', {}, p.label))));
  const preview = h('div', { class: 'pf-preview' });
  const okHint = h('div', { class: 'pf-hint' });
  const refresh = () => {
    preview.innerHTML = '';
    preview.append(
      h('div', { class: 'pf-slot' }, sel.avatar ? h('img', { src: portraitUrl(sel.avatar) }) : h('div', { class: 'pf-empty' }, '請選擇'), h('b', {}, sel.avatar ? labelOf(sel.avatar) : '我的頭像')),
      h('div', { class: 'pf-slot small' }, sel.advisor ? h('img', { src: portraitUrl(sel.advisor) }) : h('div', { class: 'pf-empty' }, '請選擇'), h('b', {}, sel.advisor ? labelOf(sel.advisor) : '我的 AI 軍師')));
    okHint.textContent = sel.avatar && sel.advisor ? '' : '頭像和 AI 軍師都要選好喔';
    const ok = document.querySelector('.modal .pf-ok');
    if (ok) ok.disabled = !(sel.avatar && sel.advisor);
  };
  const tabs = h('div', { class: 'pf-tabs' });
  const panes = {
    hero: h('div', { class: 'pf-pane on' }, h('h4', {}, '男英雄（依姓氏）'), grid(list.filter((p) => p.group === 'hero'), 'avatar')),
    beauty: h('div', { class: 'pf-pane' }, h('h4', {}, '女佳人（依姓氏）'), grid(list.filter((p) => p.group === 'beauty'), 'avatar')),
    advisor: h('div', { class: 'pf-pane' }, h('h4', {}, 'AI 軍師（男女各 15 位）'), grid(advisors(), 'advisor')),
  };
  for (const [k, t] of [['hero', '① 男英雄'], ['beauty', '① 女佳人'], ['advisor', '② AI 軍師']]) {
    tabs.append(h('button', { class: 'pf-tab' + (k === 'hero' ? ' on' : ''), 'data-k': k, onclick: () => {
      $$('.pf-tab').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
      Object.entries(panes).forEach(([kk, el]) => el.classList.toggle('on', kk === k));
    } }, t));
  }
  if (sel.avatar && portraitOf(sel.avatar)?.group === 'beauty') setTimeout(() => document.querySelector('.pf-tab[data-k="beauty"]')?.click(), 0);
  const body = h('div', { class: 'pf' }, h('p', { class: 'muted' }, '參賽前請先選好自己的半身照，再選一位陪同參賽的 AI 軍師。比賽中軍師會在旁邊分析勝率、出主意，您暫時離開時可以請軍師代打，回來再換回主位；中途也可以換另一位軍師。'),
    h('div', { class: 'pf-body' }, h('div', { class: 'pf-left' }, tabs, ...Object.values(panes)), h('div', { class: 'pf-right' }, preview, okHint)));
  setTimeout(refresh, 0);
  const buttons = required ? [{ label: '確定', value: true, primary: true }] : [{ label: '取消', value: false }, { label: '確定', value: true, primary: true }];
  return modal('選擇頭像與 AI 軍師', body, buttons, { okClass: 'pf-ok' }).then((v) => (v && sel.avatar && sel.advisor ? { avatar: sel.avatar, advisor: sel.advisor } : null));
}

// 中途更換 AI 軍師
export function pickAdvisor(current, title = '更換 AI 軍師') {
  let sel = current;
  const grid = h('div', { class: 'pf-grid' }, advisors().map((p) => h('button', {
    class: 'pf-item' + (sel === p.id ? ' on' : ''), 'data-id': p.id, title: p.label,
    onclick: () => { sel = p.id; $$('.pf-item', grid).forEach((b) => b.classList.toggle('on', b.dataset.id === p.id)); },
  }, h('img', { src: portraitUrl(p.id), alt: p.label, loading: 'lazy' }), h('span', {}, p.label))));
  const body = h('div', { class: 'pf' }, h('p', { class: 'muted' }, '選一位新的 AI 軍師陪您繼續比賽（對局與棋譜不受影響）。'), h('div', { class: 'pf-advgrid' }, grid));
  return modal(title, body, [{ label: '取消', value: false }, { label: '換這位軍師', value: true, primary: true }]).then((v) => (v && sel ? sel : null));
}
