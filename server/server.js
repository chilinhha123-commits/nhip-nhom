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

function emptyStore() {
  return { users: [], workspaces: [] };
}

function readStore() {
  if (!fs.existsSync(databaseFile)) {
    const initial = emptyStore();
    fs.writeFileSync(databaseFile, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    const data = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
    if (Array.isArray(data.users) && Array.isArray(data.workspaces)) return data;
    if (!Array.isArray(data.members) || !Array.isArray(data.tasks)) throw new Error("Dữ liệu không hợp lệ");

    const sampleIds = new Set(["m-linh", "m-minh", "m-ha", "m-nam"]);
    const sampleTaskIds = new Set(["task-brief", "task-wireframe", "task-report", "task-assets"]);
    const users = data.members.filter((member) => !sampleIds.has(member.id)
      && !member.email.toLowerCase().endsWith("@example.com"));
    const tasks = data.tasks.filter((task) => !sampleTaskIds.has(task.id));
    if (!users.length) return emptyStore();
    const owner = users[0];
    return {
      users,
      workspaces: [{
        id: `workspace-${crypto.randomUUID()}`,
        name: "Không gian làm việc",
        ownerId: owner.id,
        memberEmails: users.map((user) => user.email.toLowerCase()),
        tasks,
      }],
    };
  } catch (error) {
    console.error("Không thể đọc server/data/store.json:", error);
    throw error;
  }
}

let store = readStore();
function saveStore() {
  const contents = JSON.stringify(store, null, 2);
  if (process.platform === "win32") {
    fs.writeFileSync(databaseFile, contents);
    return;
  }
  const temporaryFile = `${databaseFile}.tmp`;
  fs.writeFileSync(temporaryFile, contents);
  fs.renameSync(temporaryFile, databaseFile);
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function userIdForEmail(email) {
  return `user-${crypto.createHash("sha256").update(normalizeEmail(email)).digest("hex").slice(0, 24)}`;
}

function userFromEmail(email, name) {
  const normalizedEmail = normalizeEmail(email);
  const found = store.users.find((user) => normalizeEmail(user.email) === normalizedEmail);
  if (found) {
    if (typeof name === "string" && name.trim()) {
      found.name = name.trim();
      saveStore();
    }
    return found;
  }
  const user = {
    id: userIdForEmail(normalizedEmail),
    name: name?.trim() || normalizedEmail.split("@")[0],
    email: normalizedEmail,
    color: "#7357d9",
  };
  store.users.push(user);
  saveStore();
  return user;
}

function workspaceMembers(workspace) {
  return workspace.memberEmails.map((email) => store.users.find(
    (user) => normalizeEmail(user.email) === normalizeEmail(email),
  ) || {
    id: userIdForEmail(email),
    name: email.split("@")[0],
    email: normalizeEmail(email),
    color: "#7357d9",
  }).map((member) => ({
    ...member,
    name: member.name?.trim() || normalizeEmail(member.email).split("@")[0],
  }));
}

function workspaceSummary(workspace) {
  return { id: workspace.id, name: workspace.name, ownerId: workspace.ownerId };
}

function workspaceForUser(workspaceId, user) {
  return store.workspaces.find((workspace) =>
    workspace.id === workspaceId
    && workspace.memberEmails.some((email) => normalizeEmail(email) === normalizeEmail(user.email)),
  );
}

function taskInWorkspace(workspace, taskId) {
  return workspace.tasks.find((task) => task.id === taskId);
}

const oauthClient = new OAuth2Client(googleClientId || undefined);
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" },
});

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));

async function authenticate(req, res, next) {
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (bearer && googleClientId) {
    try {
      const ticket = await oauthClient.verifyIdToken({ idToken: bearer, audience: googleClientId });
      const payload = ticket.getPayload();
      if (!payload?.email || payload.email_verified !== true || !payload.email.toLowerCase().endsWith("@gmail.com")) {
        return res.status(403).json({ error: "Vui lòng đăng nhập bằng địa chỉ Gmail đã xác minh." });
      }
      req.user = userFromEmail(payload.email, payload.name);
      return next();
    } catch (error) {
      console.error("Xác minh Google ID token thất bại:", error.message);
      return res.status(401).json({ error: "Phiên Google không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại." });
    }
  }

  const demoEmail = req.headers["x-demo-email"];
  if (demoMode && isValidEmail(demoEmail)) {
    req.user = userFromEmail(demoEmail);
    return next();
  }
  return res.status(401).json({ error: "Bạn cần đăng nhập bằng Google để tiếp tục." });
}

io.use(async (socket, next) => {
  const { token, demoEmail, workspaceId } = socket.handshake.auth || {};
  let user;
  if (token && googleClientId) {
    try {
      const ticket = await oauthClient.verifyIdToken({ idToken: token, audience: googleClientId });
      const payload = ticket.getPayload();
      if (payload?.email && payload.email_verified && payload.email.toLowerCase().endsWith("@gmail.com")) {
        user = userFromEmail(payload.email, payload.name);
      }
    } catch (error) {
      return next(new Error("Phiên Google không hợp lệ."));
    }
  }
  if (!user && demoMode && isValidEmail(demoEmail)) {
    user = userFromEmail(demoEmail);
  }
  const workspace = user && workspaceForUser(workspaceId, user);
  if (!workspace) return next(new Error("Không có quyền truy cập workspace."));
  socket.data.user = user;
  socket.data.workspaceId = workspace.id;
  socket.join(`workspace:${workspace.id}`);
  return next();
});

io.on("connection", (socket) => {
  socket.on("task:join", (taskId) => {
    const workspace = store.workspaces.find((item) => item.id === socket.data.workspaceId);
    if (workspace && taskInWorkspace(workspace, taskId)) socket.join(`task:${taskId}`);
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
    res.json({ token: credential, user: userFromEmail(payload.email, payload.name) });
  } catch (error) {
    console.error("Đăng nhập Google thất bại:", error.message);
    res.status(401).json({ error: "Không xác minh được tài khoản Google." });
  }
});

app.post("/api/auth/demo", (req, res) => {
  if (!demoMode) return res.status(403).json({ error: "Chế độ demo đang tắt." });
  const email = normalizeEmail(req.body?.email || "");
  if (!isValidEmail(email)) return res.status(400).json({ error: "Vui lòng nhập địa chỉ email hợp lệ." });
  res.json({ user: userFromEmail(email) });
});

app.get("/api/workspaces", authenticate, (req, res) => {
  res.json(store.workspaces
    .filter((workspace) => workspaceForUser(workspace.id, req.user))
    .map(workspaceSummary));
});

app.post("/api/workspaces", authenticate, (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ error: "Tên workspace không được để trống." });
  if (name.length > 80) return res.status(400).json({ error: "Tên workspace không được vượt quá 80 ký tự." });
  const workspace = {
    id: `workspace-${crypto.randomUUID()}`,
    name,
    ownerId: req.user.id,
    memberEmails: [normalizeEmail(req.user.email)],
    tasks: [],
  };
  store.workspaces.push(workspace);
  saveStore();
  res.status(201).json(workspaceSummary(workspace));
});

app.get("/api/workspaces/:workspaceId/team", authenticate, (req, res) => {
  const workspace = workspaceForUser(req.params.workspaceId, req.user);
  if (!workspace) return res.status(404).json({ error: "Không tìm thấy workspace." });
  res.json(workspaceMembers(workspace));
});

app.post("/api/workspaces/:workspaceId/members", authenticate, (req, res) => {
  const workspace = workspaceForUser(req.params.workspaceId, req.user);
  if (!workspace) return res.status(404).json({ error: "Không tìm thấy workspace." });
  const email = normalizeEmail(req.body?.email || "");
  if (!isValidEmail(email)) return res.status(400).json({ error: "Vui lòng nhập địa chỉ email hợp lệ." });
  const displayName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const member = userFromEmail(email, displayName);
  if (typeof displayName === "string" && displayName) member.name = displayName;
  if (!workspace.memberEmails.some((memberEmail) => normalizeEmail(memberEmail) === email)) {
    workspace.memberEmails.push(email);
    saveStore();
  }
  res.status(201).json(workspaceMembers(workspace));
});

function requireWorkspace(req, res, next) {
  const workspaceId = req.headers["x-workspace-id"];
  const workspace = workspaceForUser(workspaceId, req.user);
  if (!workspace) return res.status(403).json({ error: "Bạn không có quyền truy cập workspace này." });
  req.workspace = workspace;
  next();
}

app.get("/api/tasks", authenticate, requireWorkspace, (req, res) => {
  res.json(req.workspace.tasks);
});

function validateTask(input, workspace) {
  const statuses = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"];
  const priorities = ["LOW", "MEDIUM", "HIGH"];
  if (!input || typeof input.title !== "string" || !input.title.trim()) return "Tên nhiệm vụ không được để trống.";
  if (!statuses.includes(input.status)) return "Trạng thái nhiệm vụ không hợp lệ.";
  if (!priorities.includes(input.priority)) return "Mức ưu tiên không hợp lệ.";
  if (!Number.isFinite(Date.parse(input.deadline))) return "Vui lòng chọn thời hạn hợp lệ.";
  if (input.reminderAt != null && !Number.isFinite(Date.parse(input.reminderAt))) {
    return "Giờ báo lại không hợp lệ.";
  }
  if (input.reminderHoursBefore != null
    && (!Number.isFinite(Number(input.reminderHoursBefore))
      || Number(input.reminderHoursBefore) < 0
      || Number(input.reminderHoursBefore) > 168)) {
    return "Số giờ báo trước phải nằm trong khoảng 0 đến 168 giờ.";
  }
  const memberIds = new Set(workspaceMembers(workspace).map((member) => member.id));
  if (!memberIds.has(input.assigneeId)) {
    return "Vui lòng chọn thành viên phụ trách có trong nhóm.";
  }
  for (const roleId of [input.supporterId, input.reviewerId]) {
    if (roleId && !memberIds.has(roleId)) {
      return "Vai trò hỗ trợ và kiểm tra chéo phải thuộc thành viên trong nhóm.";
    }
  }
  return "";
}

function emailRecipients(task, workspace) {
  return [...new Set([task.assigneeId, task.supporterId, task.reviewerId])]
    .map((id) => workspaceMembers(workspace).find((member) => member.id === id)?.email)
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

function taskMailText(task, workspace, prefix) {
  const memberNames = (ids) => ids.map((id) => workspaceMembers(workspace).find((member) => member.id === id)?.name || "").filter(Boolean).join(", ");
  return `${prefix}\n\nNhiệm vụ: ${task.title}\nHạn hoàn thành: ${new Date(task.deadline).toLocaleString("vi-VN")}\nPhụ trách: ${memberNames([task.assigneeId])}\nHỗ trợ: ${memberNames([task.supporterId])}\nKiểm tra chéo: ${memberNames([task.reviewerId])}\n\nMở ứng dụng Nhịp Nhóm để xem chi tiết.`;
}

app.post("/api/tasks", authenticate, requireWorkspace, async (req, res) => {
  const validationError = validateTask(req.body, req.workspace);
  if (validationError) return res.status(400).json({ error: validationError });
  const task = {
    id: `task-${crypto.randomUUID()}`,
    title: req.body.title.trim(),
    description: typeof req.body.description === "string" ? req.body.description.trim() : "",
    status: req.body.status,
    priority: req.body.priority,
    assigneeId: req.body.assigneeId,
    supporterId: req.body.supporterId || req.body.assigneeId,
    reviewerId: req.body.reviewerId || req.body.assigneeId,
    deadline: new Date(req.body.deadline).toISOString(),
    reminderAt: req.body.reminderAt ? new Date(req.body.reminderAt).toISOString() : null,
    reminderHoursBefore: req.body.reminderAt == null && req.body.reminderHoursBefore != null
      ? Number(req.body.reminderHoursBefore)
      : null,
    createdAt: new Date().toISOString(),
    documents: [],
    comments: [],
    remindersSent: [],
  };
  req.workspace.tasks.unshift(task);
  saveStore();
  io.to(`workspace:${req.workspace.id}`).emit("tasks:changed");
  res.status(201).json({ task, warnings: [] });
  void sendMail(`Được giao nhiệm vụ: ${task.title}`, taskMailText(task, req.workspace, "Bạn có một nhiệm vụ mới trong nhóm."), emailRecipients(task, req.workspace))
    .catch((error) => console.error("Không gửi được email thông báo nhiệm vụ:", error));
});

app.put("/api/tasks/:id", authenticate, requireWorkspace, async (req, res) => {
  const validationError = validateTask(req.body, req.workspace);
  if (validationError) return res.status(400).json({ error: validationError });
  const index = req.workspace.tasks.findIndex((task) => task.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Không tìm thấy nhiệm vụ." });
  const existing = req.workspace.tasks[index];
  const changedAssignees = existing.assigneeId !== req.body.assigneeId
    || existing.supporterId !== req.body.supporterId
    || existing.reviewerId !== req.body.reviewerId;
  const changedDeadline = Date.parse(existing.deadline) !== Date.parse(req.body.deadline);
  const nextReminderAt = req.body.reminderAt ? new Date(req.body.reminderAt).toISOString() : null;
  const nextReminderHours = req.body.reminderAt == null && req.body.reminderHoursBefore != null
    ? Number(req.body.reminderHoursBefore)
    : null;
  const changedReminder = existing.reminderAt !== nextReminderAt
    || existing.reminderHoursBefore !== nextReminderHours;
  req.workspace.tasks[index] = {
    ...existing,
    title: req.body.title.trim(),
    description: typeof req.body.description === "string" ? req.body.description.trim() : "",
    status: req.body.status,
    priority: req.body.priority,
    assigneeId: req.body.assigneeId,
    supporterId: req.body.supporterId || req.body.assigneeId,
    reviewerId: req.body.reviewerId || req.body.assigneeId,
    deadline: new Date(req.body.deadline).toISOString(),
    reminderAt: nextReminderAt,
    reminderHoursBefore: nextReminderHours,
    remindersSent: changedAssignees || changedDeadline || changedReminder ? [] : existing.remindersSent,
  };
  saveStore();
  io.to(`workspace:${req.workspace.id}`).emit("tasks:changed");
  res.json({ task: req.workspace.tasks[index], warnings: [] });
  if (changedAssignees) {
    void sendMail(`Cập nhật phân công: ${req.workspace.tasks[index].title}`, taskMailText(req.workspace.tasks[index], req.workspace, "Thông tin phân công nhiệm vụ đã được cập nhật."), emailRecipients(req.workspace.tasks[index], req.workspace))
      .catch((error) => console.error("Không gửi được email cập nhật phân công:", error));
  }
});

app.patch("/api/tasks/:id/status", authenticate, requireWorkspace, (req, res) => {
  if (!["TODO", "IN_PROGRESS", "REVIEW", "DONE"].includes(req.body.status)) {
    return res.status(400).json({ error: "Trạng thái nhiệm vụ không hợp lệ." });
  }
  const task = taskInWorkspace(req.workspace, req.params.id);
  if (!task) return res.status(404).json({ error: "Không tìm thấy nhiệm vụ." });
  task.status = req.body.status;
  saveStore();
  io.to(`workspace:${req.workspace.id}`).emit("tasks:changed");
  res.json(task);
});

app.post("/api/tasks/:id/comments", authenticate, requireWorkspace, (req, res) => {
  const task = taskInWorkspace(req.workspace, req.params.id);
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

app.post("/api/tasks/:id/documents", authenticate, requireWorkspace, (req, res) => {
  const task = taskInWorkspace(req.workspace, req.params.id);
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

app.post("/api/tasks/:id/documents/upload", authenticate, requireWorkspace, upload.single("file"), (req, res) => {
  const task = taskInWorkspace(req.workspace, req.params.id);
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

app.delete("/api/tasks/:id/documents/:documentId", authenticate, requireWorkspace, (req, res) => {
  const task = taskInWorkspace(req.workspace, req.params.id);
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

app.get("/api/tasks/:id/documents/:documentId/file", authenticate, requireWorkspace, (req, res) => {
  const task = taskInWorkspace(req.workspace, req.params.id);
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
  for (const workspace of store.workspaces) {
    for (const task of workspace.tasks) {
      if (task.status === "DONE") continue;
      const deadlineTime = Date.parse(task.deadline);
      if (!Number.isFinite(deadlineTime) || deadlineTime <= now) continue;
      let schedules = [];

      if (task.reminderAt) {
        const reminderTime = Date.parse(task.reminderAt);
        if (Number.isFinite(reminderTime)) {
          schedules.push([`at:${task.reminderAt}`, reminderTime, `giờ báo lại ${new Date(reminderTime).toLocaleString("vi-VN")}`]);
        }
      } else if (task.reminderHoursBefore != null) {
        const hours = Number(task.reminderHoursBefore);
        const reminderTime = deadlineTime - hours * 60 * 60 * 1000;
        schedules.push([`hours:${hours}`, reminderTime, hours === 0 ? "đến hạn ngay bây giờ" : `còn ${hours} giờ`]);
      } else {
        schedules = [
          ["24h", deadlineTime - 24 * 60 * 60 * 1000, "còn 24 giờ"],
          ["1h", deadlineTime - 60 * 60 * 1000, "còn 1 giờ"],
        ];
      }

      for (const [key, reminderTime, label] of schedules) {
        if (now < reminderTime || (task.remindersSent || []).includes(key)) continue;
        const warnings = await sendMail(`Nhắc hạn (${label}): ${task.title}`, taskMailText(task, workspace, `Nhiệm vụ sắp đến hạn, ${label}.`), emailRecipients(task, workspace));
        if (warnings.length) {
          console.warn(`Nhắc hạn ${key} cho ${task.id} chưa gửi: ${warnings.join(" ")}`);
          continue;
        }
        task.remindersSent = [...(task.remindersSent || []), key];
        saveStore();
      }
    }
  }
}

setInterval(() => {
  sendDueReminders().catch((error) => console.error("Kiểm tra email nhắc hạn thất bại:", error));
}, 60_000).unref();
sendDueReminders().catch((error) => console.error("Kiểm tra email nhắc hạn khởi động thất bại:", error));

httpServer.listen(port, () => {
  console.log(`API Nhịp Nhóm đang chạy tại http://localhost:${port}`);
  if (!googleClientId) console.warn("Chưa cấu hình GOOGLE_CLIENT_ID: ứng dụng chỉ dùng chế độ demo.");
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) console.warn("Chưa cấu hình Gmail App Password: email thông báo chưa được gửi.");
});
