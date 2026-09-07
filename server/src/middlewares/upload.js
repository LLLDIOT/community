import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/uploads —— 与 db/data 同级
export const uploadsDir = path.resolve(__dirname, '../../uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safe = path.basename(file.originalname, ext).replace(/[^\w\u4e00-\u9fa5-]/g, '_').slice(0, 40);
    const unique = `${Date.now()}_${Math.round(Math.random() * 1e6)}`;
    cb(null, `${safe}_${unique}${ext}`);
  },
});

export const uploadAttachment = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return cb(new Error(`不支持的文件类型 ${ext}，允许：${ALLOWED_EXT.join(' ')}`));
    }
    cb(null, true);
  },
});
