import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import multer from "multer";
import nodemailer from "nodemailer";
import { OAuth2Client } from "google-auth-library";
import { createServer } from "node:http";
import { Server } from "socket.io";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(__dirname, "data");
const uploadDirectory = path.join(__dirname, "uploads");
const databaseFile = path.join(dataDirectory, "store.json");
const port = Number(process.env.PORT || 4000);
const demoMode = process.env.DEMO_MODE !== "false";
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";

fs.mkdirSync(dataDirectory, { recursive: true });
fs.mkdirSync(uploadDirectory, { recursive: true });

const seedMembers = [
  { id: "m-linh", name: "Nguyễn Ngọc Linh", email: "linh@example.com", color: "#7357d9" },
  { id: "m-minh", name: "Trần Quang Minh", email: "minh@example.com", color: "#e58b39" },
  { id: "m-ha", name: "Lê Thu Hà", email: "ha@example.com", color: "#36a28b" },
  { id: "m-nam", name: "Phạm Hoàng Nam", email: "nam@example.com", color: "#d86178" },
];

function futureDate(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function createSeedStore() {
  return {
    members: seedMembers,
    tasks: [
      {
        id: "task-brief",
        title: "Hoàn thiện brief chiến dịch mùa hè",
        description: "Chốt thông điệp chính, chân dung khách hàng và các kênh triển khai.",
        status: "IN_PROGRESS",
        priority: "HIGH",
        assigneeId: "m-linh",
        supporterId: "m-minh",
        reviewerId: "m-ha",
        deadline: futureDate(28),
        createdAt: new Date().toISOString(),
        documents: [{ id: "doc-brief", name: "Brief chiến dịch", url: "https://example.com/brief", createdAt: new Date().toISOString() }],
        comments: [
          { id: "comment-brief", authorId: "m-minh", text: "Mình đã bổ sung phần insight khách hàng.", createdAt: new Date().toISOString() },
        ],
        remindersSent: [],
      },
      {
        id: "task-wireframe",
        title: "Rà soát wireframe trang chủ",
        description: "Kiểm tra luồng điều hướng trên desktop và mobile trước khi bàn giao.",
        status: "REVIEW",
        priority: "MEDIUM",
        assigneeId: "m-ha",
        supporterId: "m-nam",
        reviewerId: "m-linh",
        deadline: futureDate(3),
        createdAt: new Date().toISOString(),
        documents: [],
        comments: [],
        remindersSent: [],
      },
      {
        id: "task-report",
        title: "Tổng hợp báo cáo tuần",
        description: "Cập nhật chỉ số và ghi chú các điểm cần theo dõi trong tuần.",
        status: "TODO",
        priority: "LOW",
        assigneeId: "m-nam",
        supporterId: "m-ha",
        reviewerId: "m-minh",
        deadline: futureDate(52),
        createdAt: new Date().toISOString(),
        documents: [],
        comments: [],
        remindersSent: [],
      },
      {
        id: "task-assets",
        title: "Bàn giao bộ nhận diện hình ảnh",
        description: "Xuất và sắp xếp các định dạng tài nguyên theo checklist.",
        status: "DONE",
        priority: "MEDIUM",
        assigneeId: "m-minh",
        supporterId: "m-linh",
        reviewerId: "m-nam",
        deadline: futureDate(-7),
        createdAt: new Date().toISOString(),
        documents: [],
        comments: [],
        remindersSent: [],
      },
    ],
  };
}

function readStore() {
  if (!fs.existsSync(databaseFile)) {
    const initial = createSeedStore();
    fs.writeFileSync(databaseFile, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    const data = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
    if (!Array.isArray(data.members) || !Array.isArray(data.tasks)) throw new Error("Dữ liệu không hợp lệ");
    return data;
  } catch (error) {
    console.error("Không thể đọc server/data/store.json:", error);
    throw error;
  }
}

let store = readStore();
function saveStore() {
  const temporaryFile = `${databaseFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2));
  fs.renameSync(temporaryFile, databaseFile);
}

const oauthClient = new OAuth2Client(googleClientId || undefined);
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" },
});

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));

function userFromDemoEmail(email) {
  const found = store.members.find((member) => member.email.toLowerCase() === email.toLowerCase());
  if (found) return found;
  const member = {
    id: `google-${Buffer.from(email.toLowerCase()).toString("base64url").slice(0, 20)}`,
    name: email.split("@")[0],
    email,
    color: "#7357d9",
  };
  store.members.push(member);
  saveStore();
  return member;
}

async function authenticate(req, res, next) {
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (bearer && googleClientId) {
    try {
      const ticket = await oauthClient.verifyIdToken({ idToken: bearer, audience: googleClientId });
      const payload = ticket.getPayload();
      if (!payload?.email || payload.email_verified !== true || !payload.email.toLowerCase().endsWith("@gmail.com")) {
        return res.status(403).json({ error: "Vui lòng đăng nhập bằng địa chỉ Gmail đã xác minh." });
      }
      req.user = userFromDemoEmail(payload.email);
      return next();
    } catch (error) {
      console.error("Xác minh Google ID token thất bại:", error.message);
      return res.status(401).json({ error: "Phiên Google không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại." });
    }
  }

  const demoEmail = req.headers["x-demo-email"];
  if (demoMode && typeof demoEmail === "string") {
    const member = store.members.find((item) => item.email === demoEmail);
    if (member) {
      req.user = member;
      return next();
    }
  }
  return res.status(401).json({ error: "Bạn cần đăng nhập bằng Google để tiếp tục." });
}

io.use(async (socket, next) => {
  const { token, demoEmail } = socket.handshake.auth || {};
  if (token && googleClientId) {
    try {
      const ticket = await oauthClient.verifyIdToken({ idToken: token, audience: googleClientId });
      const payload = ticket.getPayload();
      if (payload?.email && payload.email_verified && payload.email.toLowerCase().endsWith("@gmail.com")) {
        socket.data.user = userFromDemoEmail(payload.email);
        return next();
      }
    } catch (error) {
      return next(new Error("Phiên Google không hợp lệ."));
    }
  }
  if (demoMode && typeof demoEmail === "string" && store.members.some((item) => item.email === demoEmail)) {
    socket.data.user = store.members.find((item) => item.email === demoEmail);
    return next();
  }
  return next(new Error("Cần đăng nhập để kết nối thảo luận."));
});

io.on("connection", (socket) => {
  socket.on("task:join", (taskId) => {
    if (store.tasks.some((task) => task.id === taskId)) socket.join(`task:${taskId}`);
  });
  socket.on("task:leave", (taskId) => socket.leave(`task:${taskId}`));
});

app.get("/api/config", (req, res) => {
  res.json({
    googleClientId,
    demoMode,
    emailConfigured: Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD),
  });
});

app.post("/api/auth/google", async (req, res) => {
  if (!googleClientId) return res.status(503).json({ error: "Chưa cấu hình GOOGLE_CLIENT_ID trong file .env." });
  const { credential } = req.body || {};
  if (typeof credential !== "string") return res.status(400).json({ error: "Thiếu Google credential." });
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken: credential, audience: googleClientId });
    const payload = ticket.getPayload();
    if (!payload?.email || payload.email_verified !== true || !payload.email.toLowerCase().endsWith("@gmail.com")) {
      return res.status(403).json({ error: "Tài khoản phải là địa chỉ Gmail đã xác minh." });
    }
    res.json({ token: credential, user: userFromDemoEmail(payload.email) });
  } catch (error) {
    console.error("Đăng nhập Google thất bại:", error.message);
    res.status(401).json({ error: "Không xác minh được tài khoản Google." });
  }
});

app.get("/api/team", authenticate, (req, res) => {
  const members = [...store.members];
  if (!members.some((member) => member.email.toLowerCase() === req.user.email.toLowerCase())) members.push(req.user);
  res.json(members);
});

app.get("/api/tasks", authenticate, (req, res) => {
  res.json(store.tasks);
});

function validateTask(input) {
  const statuses = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"];
  const priorities = ["LOW", "MEDIUM", "HIGH"];
  if (!input || typeof input.title !== "string" || !input.title.trim()) return "Tên nhiệm vụ không được để trống.";
  if (!statuses.includes(input.status)) return "Trạng thái nhiệm vụ không hợp lệ.";
  if (!priorities.includes(input.priority)) return "Mức ưu tiên không hợp lệ.";
  if (!Number.isFinite(Date.parse(input.deadline))) return "Vui lòng chọn thời hạn hợp lệ.";
  const memberIds = new Set(store.members.map((member) => member.id));
  if (!memberIds.has(input.assigneeId) || !memberIds.has(input.supporterId) || !memberIds.has(input.reviewerId)) {
    return "Vui lòng chọn thành viên có trong nhóm cho cả ba vai trò.";
  }
  if (input.assigneeId === input.reviewerId) return "Người kiểm tra chéo phải khác người phụ trách chính.";
  if (input.assigneeId === input.supporterId || input.supporterId === input.reviewerId) {
    return "Ba vai trò cần được phân cho các thành viên khác nhau.";
  }
  return "";
}

function emailRecipients(task) {
  return [...new Set([task.assigneeId, task.supporterId, task.reviewerId])]
    .map((id) => store.members.find((member) => member.id === id)?.email)
    .filter(Boolean);
}

async function sendMail(subject, text, recipients) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return ["Email chưa được gửi: hãy cấu hình GMAIL_USER và GMAIL_APP_PASSWORD trong .env."];
  }
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  const results = await Promise.allSettled(recipients.map((to) => transporter.sendMail({
    from: `"Nhịp Nhóm" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    text,
  })));
  const failures = results.filter((result) => result.status === "rejected");
  failures.forEach((result) => console.error("Không gửi được email:", result.reason));
  return failures.length ? [`Không gửi được email tới ${failures.length} thành viên; kiểm tra cấu hình Gmail.`] : [];
}

function taskMailText(task, prefix) {
  const members = (ids) => ids.map((id) => store.members.find((member) => member.id === id)?.name || "").filter(Boolean).join(", ");
  return `${prefix}\n\nNhiệm vụ: ${task.title}\nHạn hoàn thành: ${new Date(task.deadline).toLocaleString("vi-VN")}\nPhụ trách: ${members([task.assigneeId])}\nHỗ trợ: ${members([task.supporterId])}\nKiểm tra chéo: ${members([task.reviewerId])}\n\nMở ứng dụng Nhịp Nhóm để xem chi tiết.`;
}

app.post("/api/tasks", authenticate, async (req, res) => {
  const validationError = validateTask(req.body);
  if (validationError) return res.status(400).json({ error: validationError });
  const task = {
    id: `task-${crypto.randomUUID()}`,
    title: req.body.title.trim(),
    description: typeof req.body.description === "string" ? req.body.description.trim() : "",
    status: req.body.status,
    priority: req.body.priority,
    assigneeId: req.body.assigneeId,
    supporterId: req.body.supporterId,
    reviewerId: req.body.reviewerId,
    deadline: new Date(req.body.deadline).toISOString(),
    createdAt: new Date().toISOString(),
    documents: [],
    comments: [],
    remindersSent: [],
  };
  store.tasks.unshift(task);
  saveStore();
  const warnings = await sendMail(`Được giao nhiệm vụ: ${task.title}`, taskMailText(task, "Bạn có một nhiệm vụ mới trong nhóm."), emailRecipients(task));
  io.emit("tasks:changed");
  res.status(201).json({ task, warnings });
});

app.put("/api/tasks/:id", authenticate, async (req, res) => {
  const validationError = validateTask(req.body);
  if (validationError) return res.status(400).json({ error: validationError });
  const index = store.tasks.findIndex((task) => task.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Không tìm thấy nhiệm vụ." });
  const existing = store.tasks[index];
  const changedAssignees = existing.assigneeId !== req.body.assigneeId
    || existing.supporterId !== req.body.supporterId
    || existing.reviewerId !== req.body.reviewerId;
  const changedDeadline = Date.parse(existing.deadline) !== Date.parse(req.body.deadline);
  store.tasks[index] = {
    ...existing,
    title: req.body.title.trim(),
    description: typeof req.body.description === "string" ? req.body.description.trim() : "",
    status: req.body.status,
    priority: req.body.priority,
    assigneeId: req.body.assigneeId,
    supporterId: req.body.supporterId,
    reviewerId: req.body.reviewerId,
    deadline: new Date(req.body.deadline).toISOString(),
    remindersSent: changedAssignees || changedDeadline ? [] : existing.remindersSent,
  };
  saveStore();
  const warnings = changedAssignees
    ? await sendMail(`Cập nhật phân công: ${store.tasks[index].title}`, taskMailText(store.tasks[index], "Thông tin phân công nhiệm vụ đã được cập nhật."), emailRecipients(store.tasks[index]))
    : [];
  io.emit("tasks:changed");
  res.json({ task: store.tasks[index], warnings });
});

app.patch("/api/tasks/:id/status", authenticate, (req, res) => {
  if (!["TODO", "IN_PROGRESS", "REVIEW", "DONE"].includes(req.body.status)) {
    return res.status(400).json({ error: "Trạng thái nhiệm vụ không hợp lệ." });
  }
  const task = store.tasks.find((item) => item.id === req.params.id);
  if (!task) return res.status(404).json({ error: "Không tìm thấy nhiệm vụ." });
  task.status = req.body.status;
  saveStore();
  io.emit("tasks:changed");
  res.json(task);
});

app.post("/api/tasks/:id/comments", authenticate, (req, res) => {
  const task = store.tasks.find((item) => item.id === req.params.id);
  if (!task) return res.status(404).json({ error: "Không tìm thấy nhiệm vụ." });
  if (typeof req.body.text !== "string" || !req.body.text.trim()) return res.status(400).json({ error: "Nội dung bình luận không được để trống." });
  if (req.body.text.length > 2000) return res.status(400).json({ error: "Bình luận không được vượt quá 2.000 ký tự." });
  const comment = {
    id: `comment-${crypto.randomUUID()}`,
    authorId: req.user.id,
    authorName: req.user.name,
    text: req.body.text.trim(),
    createdAt: new Date().toISOString(),
  };
  task.comments.push(comment);
  saveStore();
  io.to(`task:${task.id}`).emit("comment:new", { taskId: task.id, comment });
  res.status(201).json(comment);
});

app.post("/api/tasks/:id/documents", authenticate, (req, res) => {
  const task = store.tasks.find((item) => item.id === req.params.id);
  if (!task) return res.status(404).json({ error: "Không tìm thấy nhiệm vụ." });
  const url = typeof req.body.url === "string" ? req.body.url.trim() : "";
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: "Liên kết tài liệu không hợp lệ." });
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) return res.status(400).json({ error: "Liên kết cần bắt đầu bằng http:// hoặc https://." });
  if (!name) return res.status(400).json({ error: "Tên tài liệu không được để trống." });
  const document = { id: `doc-${crypto.randomUUID()}`, name, url: parsedUrl.toString(), createdAt: new Date().toISOString() };
  task.documents.push(document);
  saveStore();
  res.status(201).json(document);
});

const storage = multer.diskStorage({
  destination: uploadDirectory,
  filename: (req, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).slice(0, 12)}`),
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

app.post("/api/tasks/:id/documents/upload", authenticate, upload.single("file"), (req, res) => {
  const task = store.tasks.find((item) => item.id === req.params.id);
  if (!task) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: "Không tìm thấy nhiệm vụ." });
  }
  if (!req.file) return res.status(400).json({ error: "Vui lòng chọn tệp cần tải lên." });
  const id = `doc-${crypto.randomUUID()}`;
  const document = {
    id,
    name: path.basename(req.file.originalname),
    url: `/api/tasks/${task.id}/documents/${id}/file`,
    storageName: req.file.filename,
    createdAt: new Date().toISOString(),
  };
  task.documents.push(document);
  saveStore();
  res.status(201).json(document);
});

app.delete("/api/tasks/:id/documents/:documentId", authenticate, (req, res) => {
  const task = store.tasks.find((item) => item.id === req.params.id);
  if (!task) return res.status(404).json({ error: "Không tìm thấy nhiệm vụ." });
  const document = task.documents.find((item) => item.id === req.params.documentId);
  if (!document) return res.status(404).json({ error: "Không tìm thấy tài liệu." });
  if (document.storageName) {
    const filePath = path.join(uploadDirectory, path.basename(document.storageName));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  task.documents = task.documents.filter((item) => item.id !== document.id);
  saveStore();
  res.status(204).end();
});

app.get("/api/tasks/:id/documents/:documentId/file", authenticate, (req, res) => {
  const task = store.tasks.find((item) => item.id === req.params.id);
  if (!task) return res.status(404).json({ error: "Không tìm thấy nhiệm vụ." });
  const document = task.documents.find((item) => item.id === req.params.documentId);
  if (!document?.storageName) return res.status(404).json({ error: "Không tìm thấy tệp đính kèm." });
  const filePath = path.join(uploadDirectory, path.basename(document.storageName));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Tệp đính kèm không còn tồn tại." });
  res.download(filePath, document.name);
});

const distDirectory = path.resolve(__dirname, "..", "dist");
if (fs.existsSync(distDirectory)) {
  app.use(express.static(distDirectory));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    return res.sendFile(path.join(distDirectory, "index.html"));
  });
}

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "Tệp đính kèm vượt quá giới hạn 15 MB." });
  }
  console.error("Lỗi máy chủ:", error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: "Đã xảy ra lỗi máy chủ. Hãy xem nhật ký terminal để biết chi tiết." });
});

async function sendDueReminders() {
  const now = Date.now();
  for (const task of store.tasks) {
    if (task.status === "DONE") continue;
    const millisecondsRemaining = Date.parse(task.deadline) - now;
    for (const [key, hours, label] of [["24h", 24, "còn 24 giờ"], ["1h", 1, "còn 1 giờ"]]) {
      if (millisecondsRemaining > 0 && millisecondsRemaining <= hours * 60 * 60 * 1000 && !(task.remindersSent || []).includes(key)) {
        const warnings = await sendMail(`Nhắc hạn (${label}): ${task.title}`, taskMailText(task, `Nhiệm vụ sắp đến hạn, ${label}.`), emailRecipients(task));
        if (warnings.length) console.warn(`Nhắc hạn ${key} cho ${task.id} chưa gửi: ${warnings.join(" ")}`);
        task.remindersSent = [...(task.remindersSent || []), key];
        saveStore();
      }
    }
  }
}

setInterval(() => {
  sendDueReminders().catch((error) => console.error("Kiểm tra email nhắc hạn thất bại:", error));
}, 60_000).unref();

httpServer.listen(port, () => {
  console.log(`API Nhịp Nhóm đang chạy tại http://localhost:${port}`);
  if (!googleClientId) console.warn("Chưa cấu hình GOOGLE_CLIENT_ID: ứng dụng chỉ dùng chế độ demo.");
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) console.warn("Chưa cấu hình Gmail App Password: email thông báo chưa được gửi.");
});
