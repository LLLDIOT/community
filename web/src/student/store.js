/**
 * 学生端本地数据层
 *
 * 只存两样东西，都在浏览器本地：
 *   profile  —— 学生档案，用于表单自动填充（免重复填写）
 *   records  —— 投递记录索引（applicationId + 展示用的社团/岗位名）
 *
 * 简历正文与投递内容全部在服务端，换浏览器只是看不到本地记录，数据不会丢。
 */
import { reactive, computed } from 'vue';

const LS_PROFILE = 'student.profile.v2';
const LS_RECORDS = 'student.records.v2';

const DEFAULT_PROFILE = {
  name: '',
  phone: '',
  email: '',
  college: '',
  major: '',
  grade: '',
  skills: '',
  experiences: ['', '', ''],
  awards: ['', '', ''],
  talents: '',
  intro: '',
};

export const profile = reactive({ ...DEFAULT_PROFILE });

export const records = reactive([]);

/* ---------- 档案 ---------- */
export function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_PROFILE) || '{}');
    Object.assign(profile, DEFAULT_PROFILE, saved);
    profile.experiences = (profile.experiences || []).concat(['', '', '']).slice(0, 3);
    profile.awards = (profile.awards || []).concat(['', '', '']).slice(0, 3);
  } catch (e) {
    Object.assign(profile, DEFAULT_PROFILE);
  }
  return profile;
}

export function saveProfile(next) {
  Object.assign(profile, next);
  try {
    localStorage.setItem(LS_PROFILE, JSON.stringify(profile));
  } catch (e) {
    /* 隐私模式下可能写入失败，忽略 */
  }
}

/** 档案是否已填到"可以自动填充表单"的程度 */
export const profileReady = computed(() => Boolean(profile.name && profile.college && profile.major));

/* ---------- 投递记录 ---------- */
export function loadRecords() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_RECORDS) || '[]');
    records.splice(0, records.length, ...(Array.isArray(saved) ? saved : []));
  } catch (e) {
    records.splice(0, records.length);
  }
  return records;
}

function persistRecords() {
  try {
    localStorage.setItem(LS_RECORDS, JSON.stringify(records.slice(0, 100)));
  } catch (e) {
    /* 忽略 */
  }
}

export function addRecord(rec) {
  records.unshift(rec);
  persistRecords();
}

export function removeRecord(applicationId) {
  const i = records.findIndex((r) => r.applicationId === applicationId);
  if (i >= 0) {
    records.splice(i, 1);
    persistRecords();
  }
}

export function clearRecords() {
  records.splice(0, records.length);
  try {
    localStorage.removeItem(LS_RECORDS);
  } catch (e) {
    /* 忽略 */
  }
}
