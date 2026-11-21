import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";
import { io, type Socket } from "socket.io-client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

type Status = "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE";
type Priority = "LOW" | "MEDIUM" | "HIGH";

type Member = {
  id: string;
  name: string;
  email: string;
  color: string;
};

type DocumentItem = {
  id: string;
  name: string;
  url: string;
  createdAt: string;
};

type CommentItem = {
  id: string;
  authorId: string;
  authorName?: string;
  text: string;
  createdAt: string;
};

type Task = {
  id: string;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  assigneeId: string;
  supporterId: string;
  reviewerId: string;
  deadline: string;
  createdAt: string;
  documents: DocumentItem[];
  comments: CommentItem[];
};

type Config = {
  googleClientId: string;
  demoMode: boolean;
  emailConfigured: boolean;
};

type UserSession = {
  user: Member;
  token?: string;
  demo: boolean;
  workspaceId?: string;
};

type Workspace = {
  id: string;
  name: string;
  ownerId: string;
};

type TaskDraft = Omit<Task, "id" | "createdAt" | "documents" | "comments">;

const statuses: { key: Status; label: string; icon: string }[] = [
  { key: "TODO", label: "Cần làm", icon: "☁" },
  { key: "IN_PROGRESS", label: "Đang làm", icon: "🌱" },
  { key: "REVIEW", label: "Chờ duyệt", icon: "💌" },
  { key: "DONE", label: "Hoàn thành", icon: "⭐" },
];

const priorities: { key: Priority; label: string }[] = [
  { key: "LOW", label: "Thấp" },
  { key: "MEDIUM", label: "Trung bình" },
  { key: "HIGH", label: "Cao" },
];

const todayLabel = new Intl.DateTimeFormat("vi-VN", {
  weekday: "long",
  day: "numeric",
  month: "long",
})
  .format(new Date())
  .toLocaleUpperCase("vi-VN");

function getStoredUser(): UserSession | null {
  try {
    const stored = localStorage.getItem("nhip-nhom-user");
    return stored ? (JSON.parse(stored) as UserSession) : null;
  } catch {
    return null;
  }
}

async function api<T>(
  url: string,
  session: UserSession,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (session.token) headers.set("Authorization", `Bearer ${session.token}`);
  if (session.demo) headers.set("X-Demo-Email", session.user.email);
  if (session.workspaceId) headers.set("X-Workspace-Id", session.workspaceId);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Yêu cầu thất bại (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function dateInputValue(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function memberColor(member?: Member) {
  if (!member) return "#a7c7e7";
  const palette = ["#77bde5", "#8dc9e7", "#a5d5ec", "#84b6d6", "#9acde8"];
  const index = [...member.id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return palette[index % palette.length];
}

function memberLabel(member?: Member) {
  if (!member) return "";
  return `${member.name} (${member.email})`;
}

function Avatar({
  member,
  size = "normal",
}: {
  member?: Member;
  size?: "normal" | "small";
}) {
  const initials =
    member?.name
      .split(" ")
      .slice(-2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?";

  return (
    <span
      className={`avatar ${size}`}
      style={{ backgroundColor: memberColor(member) }}
      title={member?.name}
    >
      {initials}
    </span>
  );
}

function CloudSticker({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 150 125"
      role="img"
      aria-label="Bạn mây xanh đang mỉm cười"
    >
      <path
        d="M38 99c-17 0-29-12-29-27 0-14 11-25 26-27 5-20 21-33 42-33 24 0 42 17 45 40 14 2 23 12 23 25 0 13-11 22-27 22H38Z"
        fill="#A7C7E7"
        stroke="#6FAED5"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path d="M51 67v2m38-2v2" stroke="#315B73" strokeWidth="6" strokeLinecap="round" />
      <path d="M63 77q7 10 14 0" fill="none" stroke="#315B73" strokeWidth="4" strokeLinecap="round" />
      <ellipse cx="39" cy="79" rx="8" ry="4" fill="#F3A9AC" opacity=".8" />
      <ellipse cx="101" cy="79" rx="8" ry="4" fill="#F3A9AC" opacity=".8" />
      <path d="m125 11 4 9 10 1-7 6 2 9-9-5-8 5 2-9-7-6 10-1 3-9Z" fill="#FFE18A" stroke="#E8BD5D" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function CatPencilSticker({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 150 155"
      role="img"
      aria-label="Chú mèo nhỏ đang cầm bút chì"
    >
      <path
        d="m38 52-7-29 28 15c11-4 23-4 34 0l27-15-6 32c8 11 11 25 9 42-4 27-22 43-47 43-27 0-47-18-49-46-1-16 3-31 11-42Z"
        fill="#FFFEFA"
        stroke="#6FAED5"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path d="m42 45-4-12 15 8m43 0 14-8-3 15" fill="none" stroke="#A7C7E7" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M54 76v2m38-2v2" stroke="#355B70" strokeWidth="6" strokeLinecap="round" />
      <path d="M67 89q7 9 14 0" fill="none" stroke="#355B70" strokeWidth="4" strokeLinecap="round" />
      <ellipse cx="44" cy="87" rx="8" ry="4" fill="#F3A9AC" opacity=".8" />
      <ellipse cx="102" cy="87" rx="8" ry="4" fill="#F3A9AC" opacity=".8" />
      <path d="m113 109 22-35 9 6-22 35-12 7 3-13Z" fill="#FFD978" stroke="#6FAED5" strokeWidth="3" strokeLinejoin="round" />
      <path d="m113 109 9 6" stroke="#6FAED5" strokeWidth="3" />
      <path d="m18 94 3 6 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1 3-6Z" fill="#FFD978" stroke="#E8BD5D" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function formatCountdown(value: string, now: number) {
  const milliseconds = Date.parse(value) - now;
  if (milliseconds <= 0) return { text: "Đã quá hạn", expired: true };

  const seconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;

  return {
    text: `${days} ngày ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`,
    expired: false,
  };
}

function TaskCard({
  task,
  members,
  onOpen,
  onStatusChange,
}: {
  task: Task;
  members: Member[];
  onOpen: () => void;
  onStatusChange: (status: Status) => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const countdown = formatCountdown(task.deadline, now);
  const remaining = Date.parse(task.deadline) - now;
  const urgent = remaining <= 24 * 60 * 60 * 1_000 && task.status !== "DONE";
  const status = statuses.find((item) => item.key === task.status);
  const person = (id: string) => members.find((member) => member.id === id);

  return (
    <article
      className={`task-card ${task.status === "DONE" ? "completed-card" : ""}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onOpen();
      }}
      tabIndex={0}
    >
      <div className="card-topline">
        <span className={`priority priority-${task.priority.toLowerCase()}`}>
          <i />
          {priorities.find((item) => item.key === task.priority)?.label}
        </span>
        <label className="card-status-select" onClick={(event) => event.stopPropagation()}>
          <span aria-hidden="true">···</span>
          <select
            aria-label="Đổi trạng thái nhiệm vụ"
            value={task.status}
            onChange={(event) => onStatusChange(event.target.value as Status)}
          >
            {statuses.map((item) => (
              <option value={item.key} key={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <h3>{task.title}</h3>
      {task.description && <p className="task-description">{task.description}</p>}

      <div className={`countdown ${urgent ? "urgent" : ""}`}>
        <span className="countdown-icon" aria-hidden="true">
          ◷
        </span>
        <span>{countdown.text}</span>
        {!countdown.expired && <small>còn lại</small>}
      </div>

      <div className="card-footer">
        <div
          className="assignee-stack"
          aria-label={`Phụ trách: ${memberLabel(person(task.assigneeId)) || "chưa gán"}`}
        >
          {[task.assigneeId, task.supporterId, task.reviewerId].map((id) => (
            <Avatar key={id} size="small" member={person(id)} />
          ))}
        </div>
        <div className="card-meta">
          {task.documents.length > 0 && (
            <span title="Tài liệu">↗ {task.documents.length}</span>
          )}
          {task.comments.length > 0 && (
            <span title="Bình luận">♡ {task.comments.length}</span>
          )}
          <span className={`tiny-status ${status?.key.toLowerCase()}`} title={status?.label} />
        </div>
      </div>
    </article>
  );
}

function TaskForm({
  task,
  members,
  onSave,
  onClose,
  busy,
}: {
  task?: Task;
  members: Member[];
  onSave: (draft: TaskDraft) => Promise<void>;
  onClose: () => void;
  busy: boolean;
}) {
  const initialAssignee = task?.assigneeId || members[0]?.id || "";
  const initialSupporter =
    task?.supporterId ||
    members.find((member) => member.id !== initialAssignee)?.id ||
    initialAssignee;
  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [status, setStatus] = useState<Status>(task?.status || "TODO");
  const [priority, setPriority] = useState<Priority>(task?.priority || "MEDIUM");
  const [assigneeId, setAssigneeId] = useState(initialAssignee);
  const [supporterId, setSupporterId] = useState(initialSupporter);
  const [reviewerId, setReviewerId] = useState(task?.reviewerId || "");
  const [reviewerMode, setReviewerMode] = useState<"manual" | "random">("manual");
  const [deadline, setDeadline] = useState(
    task
      ? dateInputValue(task.deadline)
      : dateInputValue(new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString()),
  );
  const [formError, setFormError] = useState("");

  const reviewerOptions = members;

  useEffect(() => {
    if (!supporterId && initialAssignee) setSupporterId(initialAssignee);
    if (!reviewerId && initialAssignee) setReviewerId(initialAssignee);
  }, [initialAssignee, supporterId, reviewerId]);

  function chooseAssignee(nextId: string) {
    setAssigneeId(nextId);
  }

  function chooseRandomReviewer() {
    if (!reviewerOptions.length) {
      setFormError("Cần ít nhất ba thành viên để phân đủ các vai trò.");
      return;
    }
    const choice = reviewerOptions[Math.floor(Math.random() * reviewerOptions.length)];
    setReviewerId(choice.id);
    setReviewerMode("random");
    setFormError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !deadline || !assigneeId || !supporterId || !reviewerId) {
      setFormError("Hãy điền tên, hạn hoàn thành và chọn đủ ba vai trò.");
      return;
    }
    try {
      setFormError("");
      await onSave({
        title: title.trim(),
        description,
        status,
        priority,
        assigneeId,
        supporterId,
        reviewerId,
        deadline: new Date(deadline).toISOString(),
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Không lưu được nhiệm vụ.");
    }
  }

  const memberName = (id: string) => memberLabel(members.find((member) => member.id === id));

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="dialog form-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-form-title"
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">{task ? "CHỈNH SỬA" : "TẠO MỚI"}</span>
            <h2 id="task-form-title">{task ? "Sửa nhiệm vụ" : "Tạo nhiệm vụ"}</h2>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>

        <form onSubmit={submit} className="task-form">
          <label>
            Tên nhiệm vụ
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ví dụ: Hoàn thiện kế hoạch quý IV"
              autoFocus
              maxLength={120}
            />
          </label>
          <label>
            Mô tả
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Mục tiêu, ghi chú hoặc tiêu chí hoàn thành..."
              rows={3}
              maxLength={1_000}
            />
          </label>

          <div className="form-grid">
            <label>
              Trạng thái
              <select value={status} onChange={(event) => setStatus(event.target.value as Status)}>
                {statuses.map((item) => (
                  <option value={item.key} key={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Mức ưu tiên
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value as Priority)}
              >
                {priorities.map((item) => (
                  <option value={item.key} key={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="form-grid">
            <label>
              Người phụ trách chính
              <select value={assigneeId} onChange={(event) => chooseAssignee(event.target.value)}>
                {members.map((member) => (
                  <option value={member.id} key={member.id}>
                    {memberLabel(member)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Người hỗ trợ
              <select value={supporterId} onChange={(event) => setSupporterId(event.target.value)}>
                {members
                  .map((member) => (
                    <option value={member.id} key={member.id}>
                      {memberLabel(member)}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <div className="reviewer-label">
            <span>Người kiểm tra chéo</span>
            <div className="mode-toggle">
              <button
                type="button"
                className={reviewerMode === "manual" ? "selected" : ""}
                onClick={() => setReviewerMode("manual")}
              >
                Tự chọn
              </button>
              <button
                type="button"
                className={reviewerMode === "random" ? "selected" : ""}
                onClick={chooseRandomReviewer}
              >
                ✦ Random
              </button>
            </div>
          </div>
          <label className="sr-only" htmlFor="reviewer-select">
            Chọn người kiểm tra chéo
          </label>
          <select
            id="reviewer-select"
            value={reviewerId}
            onChange={(event) => {
              setReviewerId(event.target.value);
              setReviewerMode("manual");
            }}
          >
            <option value="">Chọn thành viên</option>
            {reviewerOptions.map((member) => (
              <option value={member.id} key={member.id}>
                {memberLabel(member)}
              </option>
            ))}
          </select>
          {reviewerId && (
            <p className="reviewer-hint">
              Đã chọn <strong>{memberName(reviewerId)}</strong> · khác hai vai trò còn lại
            </p>
          )}

          <label>
            Hạn hoàn thành
            <input
              type="datetime-local"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
            />
          </label>
          {formError && <p className="inline-error">{formError}</p>}

          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              Huỷ
            </button>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? "Đang lưu..." : task ? "Lưu thay đổi" : "Tạo nhiệm vụ"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function TaskDetail({
  task,
  members,
  session,
  socket,
  onClose,
  onEdit,
  onDataChange,
  onNotice,
}: {
  task: Task;
  members: Member[];
  session: UserSession;
  socket: Socket | null;
  onClose: () => void;
  onEdit: () => void;
  onDataChange: () => void;
  onNotice: (message: string) => void;
}) {
  const [comment, setComment] = useState("");
  const [liveComments, setLiveComments] = useState(task.comments);
  const [documentName, setDocumentName] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const commentsEnd = useRef<HTMLDivElement>(null);
  const memberById = (id: string) => members.find((member) => member.id === id);

  useEffect(() => {
    socket?.emit("task:join", task.id);
    const onNewComment = (payload: { taskId: string; comment: CommentItem }) => {
      if (payload.taskId === task.id) {
        setLiveComments((current) =>
          current.some((item) => item.id === payload.comment.id)
            ? current
            : [...current, payload.comment],
        );
      }
    };
    socket?.on("comment:new", onNewComment);
    return () => {
      socket?.emit("task:leave", task.id);
      socket?.off("comment:new", onNewComment);
    };
  }, [socket, task.id]);

  useEffect(() => {
    setLiveComments(task.comments);
  }, [task.id, task.comments]);

  useEffect(() => {
    commentsEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [liveComments.length]);

  async function sendComment(event: FormEvent) {
    event.preventDefault();
    if (!comment.trim()) return;

    setSubmitting(true);
    setError("");
    try {
      const saved = await api<CommentItem>(`/api/tasks/${task.id}/comments`, session, {
        method: "POST",
        body: JSON.stringify({ text: comment }),
      });
      setLiveComments((current) =>
        current.some((item) => item.id === saved.id) ? current : [...current, saved],
      );
      setComment("");
      onDataChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không gửi được bình luận.");
    } finally {
      setSubmitting(false);
    }
  }

  async function addLink(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/tasks/${task.id}/documents`, session, {
        method: "POST",
        body: JSON.stringify({ name: documentName, url: documentUrl }),
      });
      setDocumentName("");
      setDocumentUrl("");
      onDataChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thêm được tài liệu.");
    }
  }

  async function uploadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError("");
    const data = new FormData();
    data.append("file", file);
    try {
      await api(`/api/tasks/${task.id}/documents/upload`, session, {
        method: "POST",
        body: data,
      });
      onDataChange();
      onNotice(`Đã tải lên ${file.name}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không tải được tệp.");
    } finally {
      event.target.value = "";
    }
  }

  async function deleteDocument(documentId: string) {
    try {
      await api(`/api/tasks/${task.id}/documents/${documentId}`, session, {
        method: "DELETE",
      });
      onDataChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không xoá được tài liệu.");
    }
  }

  async function openDocument(document: DocumentItem) {
    if (!document.url.startsWith("/api/")) {
      window.open(document.url, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const headers = new Headers();
      if (session.token) headers.set("Authorization", `Bearer ${session.token}`);
      if (session.demo) headers.set("X-Demo-Email", session.user.email);
      const response = await fetch(document.url, { headers });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Không tải được tài liệu.");
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = window.document.createElement("a");
      link.href = objectUrl;
      link.download = document.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không tải được tài liệu.");
    }
  }

  const roles = [
    { label: "Phụ trách chính", id: task.assigneeId, icon: "☀" },
    { label: "Người hỗ trợ", id: task.supporterId, icon: "☁" },
    { label: "Kiểm tra chéo", id: task.reviewerId, icon: "✿" },
  ];

  return (
    <div
      className="modal-backdrop drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <header className="drawer-header">
          <div>
            <span className="eyebrow">GÓC NHIỆM VỤ</span>
            <div className="drawer-header-actions">
              <button className="button secondary compact" onClick={onEdit}>
                Chỉnh sửa
              </button>
              <button className="close-button" onClick={onClose} aria-label="Đóng">
                ×
              </button>
            </div>
          </div>
        </header>

        <div className="drawer-content">
          <span className={`priority priority-${task.priority.toLowerCase()}`}>
            <i />
            {priorities.find((item) => item.key === task.priority)?.label} ưu tiên
          </span>
          <h2 id="detail-title">{task.title}</h2>
          <p className="detail-description">
            {task.description || "Chưa có mô tả cho nhiệm vụ này."}
          </p>
          <div className="detail-deadline">
            <span>HẠN HOÀN THÀNH</span>
            <strong>
              {new Date(task.deadline).toLocaleString("vi-VN", {
                dateStyle: "long",
                timeStyle: "short",
              })}
            </strong>
          </div>

          <section className="detail-section">
            <div className="section-title">
              <h3>Những người đồng hành</h3>
              <span>3 vai trò</span>
            </div>
            <div className="role-list">
              {roles.map((role) => {
                const member = memberById(role.id);
                return (
                  <div className="role-item" key={role.label}>
                    <span className="role-icon">{role.icon}</span>
                    <Avatar member={member} />
                    <div>
                      <small>{role.label}</small>
                      <strong>{memberLabel(member) || "Chưa phân công"}</strong>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="detail-section">
            <div className="section-title">
              <h3>Tài liệu nhỏ xinh</h3>
              <span>{task.documents.length}</span>
            </div>
            <div className="document-list">
              {task.documents.length ? (
                task.documents.map((document) => (
                  <div className="document-item" key={document.id}>
                    <span className="document-icon">↗</span>
                    <button className="document-link" onClick={() => openDocument(document)}>
                      {document.name}
                    </button>
                    <button
                      aria-label={`Xoá ${document.name}`}
                      onClick={() => deleteDocument(document.id)}
                    >
                      ×
                    </button>
                  </div>
                ))
              ) : (
                <p className="empty-note">Chưa có tài liệu đính kèm.</p>
              )}
            </div>
            <form className="link-form" onSubmit={addLink}>
              <input
                aria-label="Tên tài liệu"
                placeholder="Tên tài liệu"
                value={documentName}
                onChange={(event) => setDocumentName(event.target.value)}
              />
              <input
                aria-label="Đường dẫn tài liệu"
                type="url"
                placeholder="https://..."
                value={documentUrl}
                onChange={(event) => setDocumentUrl(event.target.value)}
              />
              <button className="button secondary compact" type="submit">
                Thêm link
              </button>
            </form>
            <label className="upload-button">
              ＋ Tải tệp lên
              <input type="file" onChange={uploadFile} />
            </label>
            <small className="upload-note">Tối đa 15 MB mỗi tệp</small>
          </section>

          <section className="detail-section discussion-section">
            <div className="section-title">
              <h3>Góc trò chuyện</h3>
              <span className="live-dot">● Đang trực tiếp</span>
            </div>
            <div className="comment-list">
              {liveComments.map((item) => {
                const author = memberById(item.authorId);
                const guest = item.authorName
                  ? { id: item.authorId, name: item.authorName, email: "", color: "#a7c7e7" }
                  : undefined;
                return (
                  <article className="comment-item" key={item.id}>
                    <Avatar member={author || guest} size="small" />
                    <div className="comment-body">
                      <div className="comment-by">
                        <strong>{item.authorName || author?.name || "Thành viên"}</strong>
                        <time>
                          {new Date(item.createdAt).toLocaleString("vi-VN", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </time>
                      </div>
                      <p>{item.text}</p>
                    </div>
                  </article>
                );
              })}
              {liveComments.length === 0 && (
                <p className="empty-note">Chưa có lời nhắn nào. Hãy bắt đầu trò chuyện nhé!</p>
              )}
              <div ref={commentsEnd} />
            </div>
            <form className="comment-form" onSubmit={sendComment}>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Viết lời nhắn..."
                rows={2}
                maxLength={2_000}
              />
              <div>
                <span>{comment.length}/2000</span>
                <button
                  className="button primary compact"
                  type="submit"
                  disabled={!comment.trim() || submitting}
                >
                  {submitting ? "Đang gửi..." : "Gửi lời nhắn"}
                </button>
              </div>
            </form>
          </section>
          {error && <p className="inline-error">{error}</p>}
        </div>
      </aside>
    </div>
  );
}

function LoginPage({
  config,
  demoEmail,
  loadError,
  googleButtonWidth,
  onDemoEmailChange,
  onDemoLogin,
  onGoogleLogin,
}: {
  config: Config;
  demoEmail: string;
  loadError: string;
  googleButtonWidth: number;
  onDemoEmailChange: (email: string) => void;
  onDemoLogin: () => void;
  onGoogleLogin: (credential: CredentialResponse) => void;
}) {
  const [googleSetupMessage, setGoogleSetupMessage] = useState("");

  return (
    <main className="login-page">
      <section className="login-hero">
        <div className="brand login-brand">
          <span className="brand-mark">n</span>
          <span>nhịp nhóm</span>
        </div>
        <div className="login-hero-copy">
          <CloudSticker className="hero-cloud-sticker" />
          <span className="eyebrow">MỖI NGÀY MỘT NHỊP NHÀNG</span>
          <h1>
            Cùng nhau làm việc,
            <br />
            <em>nhẹ nhàng tiến bước.</em>
          </h1>
          <p>
            Nhiệm vụ rõ ràng, lời nhắn kịp lúc và thời hạn luôn trong tầm mắt — để cả nhóm yên tâm
            tập trung.
          </p>
          <div className="login-preview">
            <CatPencilSticker className="preview-cat-sticker" />
            <div className="preview-heading">
              <span className="preview-sun">☼</span>
              <span>KHÔNG GIAN CỦA BẠN</span>
            </div>
            <div className="preview-empty">
              <span aria-hidden="true">☁</span>
              <strong>Bắt đầu từ trang trắng</strong>
              <small>Tạo workspace riêng cho nhóm của bạn.</small>
            </div>
            <div className="preview-cloud" aria-hidden="true">☁</div>
          </div>
        </div>
        <div className="login-hero-foot">
          <span>☁ Ít áp lực hơn</span>
          <span>✿ Nhiều niềm vui hơn</span>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div className="login-card-mark">
            <CloudSticker className="login-cloud-icon" />
          </div>
          <span className="eyebrow">CHÀO MỪNG BẠN</span>
          <h2>Đăng nhập vào Nhịp Nhóm</h2>
          <p className="login-subtitle">Tiếp tục làm việc vui vẻ cùng nhóm của bạn.</p>

          <div className="google-login">
            {config.googleClientId ? (
              <GoogleLogin
                width={String(googleButtonWidth)}
                theme="filled_blue"
                shape="pill"
                size="large"
                text="signin_with"
                locale="vi"
                logo_alignment="center"
                onSuccess={onGoogleLogin}
                onError={() => setGoogleSetupMessage("Đăng nhập Google chưa thành công. Hãy thử lại nhé.")}
              />
            ) : (
              <button
                className="google-action"
                onClick={() =>
                  setGoogleSetupMessage(
                    "Để đăng nhập thật, hãy thêm GOOGLE_CLIENT_ID vào file .env rồi khởi động lại ứng dụng.",
                  )
                }
              >
                <span className="google-g" aria-hidden="true">G</span>
                <span>Đăng nhập bằng Google</span>
                <span className="google-arrow" aria-hidden="true">→</span>
              </button>
            )}
          </div>
          {googleSetupMessage && <p className="login-error">{googleSetupMessage}</p>}
          {!config.googleClientId && (
            <p className="config-hint">Nút đăng nhập luôn sẵn sàng · cần cấu hình Client ID để sử dụng.</p>
          )}

          {config.demoMode && (
            <>
              <div className="separator"><span>HOẶC DÙNG THỬ BẢN DEMO</span></div>
              <div className="demo-picker">
                <label htmlFor="demo-email">Email của bạn</label>
                <input
                  id="demo-email"
                  type="email"
                  autoComplete="email"
                  placeholder="ban@congty.com"
                  value={demoEmail}
                  onChange={(event) => onDemoEmailChange(event.target.value)}
                />
                <button className="demo-button" onClick={onDemoLogin} disabled={!demoEmail.trim()}>
                  Tiếp tục <span aria-hidden="true">→</span>
                </button>
              </div>
            </>
          )}
          {!config.demoMode && !config.googleClientId && (
            <p className="inline-error">Chưa cấu hình GOOGLE_CLIENT_ID. Xem HUONG_DAN_CAI_DAT.md.</p>
          )}
          {loadError && <p className="login-error">{loadError}</p>}
          <p className="login-foot">Mỗi workspace có thành viên và bảng công việc riêng.</p>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [config, setConfig] = useState<Config>({
    googleClientId: "",
    demoMode: true,
    emailConfigured: false,
  });
  const [session, setSession] = useState<UserSession | null>(getStoredUser);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [demoEmail, setDemoEmail] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [modalTask, setModalTask] = useState<Task | null | "new">(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"board" | "list">("board");
  const [menuOpen, setMenuOpen] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberName, setMemberName] = useState("");
  const [showWorkspaceForm, setShowWorkspaceForm] = useState(false);
  const [showMemberForm, setShowMemberForm] = useState(false);
  const currentUser = session?.user;
  const googleButtonWidth = Math.min(360, Math.max(220, window.innerWidth - 112));

  const reload = useCallback(async () => {
    if (!session) return;
    try {
      const workspaceData = await api<Workspace[]>("/api/workspaces", session);
      setWorkspaces(workspaceData);
      const activeWorkspace = workspaceData.find((workspace) => workspace.id === session.workspaceId)
        || workspaceData[0];
      if (!activeWorkspace) {
        setMembers([]);
        setTasks([]);
        setLoadError("");
        return;
      }
      const scopedSession = { ...session, workspaceId: activeWorkspace.id };
      if (session.workspaceId !== activeWorkspace.id) {
        localStorage.setItem("nhip-nhom-user", JSON.stringify(scopedSession));
        setSession(scopedSession);
      }
      const [taskData, teamData] = await Promise.all([
        api<Task[]>("/api/tasks", scopedSession),
        api<Member[]>(`/api/workspaces/${activeWorkspace.id}/team`, scopedSession),
      ]);
      setTasks(taskData);
      setMembers(teamData);
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Không tải được dữ liệu.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetch("/api/config")
      .then((response) => response.json())
      .then((data: Config) => setConfig(data))
      .catch(() => {
        setLoadError("Không kết nối được máy chủ. Hãy chạy CHAY_UNG_DUNG.bat.");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (session) reload();
  }, [session, reload]);

  useEffect(() => {
    if (!session?.workspaceId) return;
    const connection = io("/", {
      auth: session.token
        ? { token: session.token, workspaceId: session.workspaceId }
        : { demoEmail: session.user.email, workspaceId: session.workspaceId },
    });
    connection.on("tasks:changed", reload);
    connection.on("connect_error", (error) =>
      setLoadError(`Kết nối trực tiếp bị gián đoạn: ${error.message}`),
    );
    connection.on("connect", () => setLoadError(""));
    setSocket(connection);
    return () => {
      connection.disconnect();
      setSocket(null);
    };
  }, [session, reload]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3_800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const filteredTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const matchesSearch = `${task.title} ${task.description}`
          .toLowerCase()
          .includes(search.toLowerCase());
        const matchesFilter =
          filter === "all" || task.status === filter || task.priority === filter;
        return matchesSearch && matchesFilter;
      }),
    [tasks, filter, search],
  );
  const doneCount = tasks.filter((task) => task.status === "DONE").length;
  const activeCount = tasks.filter((task) => task.status === "IN_PROGRESS").length;
  const dueSoonCount = tasks.filter((task) => {
    const remaining = Date.parse(task.deadline) - Date.now();
    return task.status !== "DONE" && remaining >= 0 && remaining <= 24 * 60 * 60 * 1_000;
  }).length;
  const detailTask = detailTaskId ? tasks.find((task) => task.id === detailTaskId) : undefined;

  function storeSession(next: UserSession) {
    const freshSession = { ...next, workspaceId: undefined };
    localStorage.setItem("nhip-nhom-user", JSON.stringify(freshSession));
    setSession(freshSession);
    setLoading(true);
  }

  async function demoLogin() {
    setBusy(true);
    setLoadError("");
    try {
      const response = await fetch("/api/auth/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: demoEmail }),
      });
      const data = (await response.json()) as { user?: Member; error?: string };
      if (!response.ok || !data.user) throw new Error(data.error || "Đăng nhập demo thất bại.");
      storeSession({ user: data.user, demo: true });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Đăng nhập demo thất bại.");
    } finally {
      setBusy(false);
    }
  }

  async function googleLogin(result: CredentialResponse) {
    if (!result.credential) {
      setLoadError("Google không trả về thông tin đăng nhập. Hãy thử lại.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: result.credential }),
      });
      const data = (await response.json()) as {
        token?: string;
        user?: Member;
        error?: string;
      };
      if (!response.ok || !data.token || !data.user) {
        throw new Error(data.error || "Đăng nhập Google thất bại.");
      }
      storeSession({ user: data.user, token: data.token, demo: false });
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Đăng nhập Google thất bại.");
    } finally {
      setBusy(false);
    }
  }

  async function saveTask(draft: TaskDraft) {
    if (!session) throw new Error("Bạn cần đăng nhập để lưu nhiệm vụ.");
    setBusy(true);
    try {
      const editing = modalTask && modalTask !== "new";
      const result = await api<{ task: Task; warnings: string[] }>(
        editing ? `/api/tasks/${modalTask.id}` : "/api/tasks",
        session,
        {
          method: editing ? "PUT" : "POST",
          body: JSON.stringify(draft),
        },
      );
      setTasks((current) =>
        editing
          ? current.map((item) => (item.id === result.task.id ? result.task : item))
          : [result.task, ...current],
      );
      setModalTask(null);
      setNotice(
        result.warnings?.length
          ? result.warnings.join(" ")
          : "Đã lưu nhiệm vụ thật gọn gàng!",
      );
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(taskId: string, status: Status) {
    if (!session) return;
    try {
      await api(`/api/tasks/${taskId}/status`, session, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setTasks((current) =>
        current.map((task) => (task.id === taskId ? { ...task, status } : task)),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không đổi được trạng thái.");
    }
  }

  async function createWorkspace(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    try {
      const workspace = await api<Workspace>("/api/workspaces", session, {
        method: "POST",
        body: JSON.stringify({ name: workspaceName }),
      });
      setLoadError("");
      const nextSession = { ...session, workspaceId: workspace.id };
      localStorage.setItem("nhip-nhom-user", JSON.stringify(nextSession));
      setSession(nextSession);
      setWorkspaces((current) => [...current, workspace]);
      setWorkspaceName("");
      setShowWorkspaceForm(false);
      setLoading(true);
      setNotice(`Đã tạo workspace "${workspace.name}".`);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Không tạo được workspace.");
    } finally {
      setBusy(false);
    }
  }

  async function addMember(event: FormEvent) {
    event.preventDefault();
    if (!session?.workspaceId) return;
    setBusy(true);
    try {
      const team = await api<Member[]>(`/api/workspaces/${session.workspaceId}/members`, session, {
        method: "POST",
        body: JSON.stringify({ email: memberEmail, name: memberName }),
      });
      setMembers(team);
      setMemberEmail("");
      setMemberName("");
      setShowMemberForm(false);
      setNotice("Đã thêm email vào workspace. Thành viên có thể đăng nhập bằng địa chỉ này.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thêm được thành viên.");
    } finally {
      setBusy(false);
    }
  }

  function switchWorkspace(workspaceId: string) {
    if (!session || workspaceId === session.workspaceId) return;
    const nextSession = { ...session, workspaceId };
    localStorage.setItem("nhip-nhom-user", JSON.stringify(nextSession));
    setSession(nextSession);
    setTasks([]);
    setMembers([]);
    setDetailTaskId(null);
    setLoading(true);
  }

  function signOut() {
    localStorage.removeItem("nhip-nhom-user");
    setSession(null);
    setWorkspaces([]);
    setMembers([]);
    setTasks([]);
    setLoading(false);
    setDetailTaskId(null);
  }

  const activeWorkspace = workspaces.find((workspace) => workspace.id === session?.workspaceId);

  if (!session) {
    return (
      <LoginPage
        config={config}
        demoEmail={demoEmail}
        loadError={loadError}
        googleButtonWidth={googleButtonWidth}
        onDemoEmailChange={setDemoEmail}
        onDemoLogin={demoLogin}
        onGoogleLogin={googleLogin}
      />
    );
  }

  if (!activeWorkspace && loading) {
    return (
      <main className="workspace-empty-page">
        <div className="loading-state">
          <div className="spinner" />
          <p>Đang tải workspace...</p>
        </div>
      </main>
    );
  }

  if (!activeWorkspace) {
    return (
      <main className="workspace-empty-page">
        <section className="workspace-empty-card">
          <div className="brand">
            <span className="brand-mark">n</span>
            <span>nhịp nhóm</span>
          </div>
          <CloudSticker className="workspace-empty-cloud" />
          <span className="eyebrow">CHÀO {currentUser?.name.toLocaleUpperCase("vi-VN")}</span>
          <h1>Tạo workspace đầu tiên</h1>
          <p>
            Workspace mới bắt đầu hoàn toàn trống. Bạn có thể tạo bảng riêng và thêm thành viên
            bằng email của họ.
          </p>
          {loadError && <p className="inline-error">{loadError}</p>}
          <form onSubmit={createWorkspace} className="workspace-create-form">
            <label htmlFor="first-workspace-name">Tên workspace</label>
            <input
              id="first-workspace-name"
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              placeholder="Ví dụ: Nhóm sản phẩm"
              maxLength={80}
              required
            />
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? "Đang tạo..." : "Tạo workspace"}
            </button>
          </form>
          <button className="side-link workspace-signout" onClick={signOut}>Đăng xuất</button>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">n</span>
          <span>nhịp nhóm</span>
        </div>
        <div className="workspace-switch">
          <span className="workspace-icon">☁</span>
          <div>
            <select
              aria-label="Chọn workspace"
              value={activeWorkspace.id}
              onChange={(event) => switchWorkspace(event.target.value)}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
              ))}
            </select>
            <small>Không gian làm việc</small>
          </div>
          <button
            className="workspace-add-button"
            aria-label="Tạo workspace"
            title="Tạo workspace"
            onClick={() => setShowWorkspaceForm((open) => !open)}
          >
            ＋
          </button>
        </div>
        {showWorkspaceForm && (
          <form className="sidebar-inline-form" onSubmit={createWorkspace}>
            <input
              aria-label="Tên workspace mới"
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              placeholder="Tên workspace"
              maxLength={80}
              required
            />
            <button type="submit" disabled={busy}>Tạo</button>
          </form>
        )}

        <div className="side-label">GÓC CỦA NHÓM</div>
        <nav className="side-nav">
          <button
            className={`nav-item ${view === "board" ? "active" : ""}`}
            onClick={() => setView("board")}
          >
            <span>▦</span>Tổng quan <kbd>⌘ 1</kbd>
          </button>
          <button
            className={`nav-item ${view === "list" ? "active" : ""}`}
            onClick={() => setView("list")}
          >
            <span>☷</span>Tất cả nhiệm vụ
          </button>
        </nav>

        <div className="side-label team-label">
          CÁC THÀNH VIÊN <span aria-hidden="true">✿</span>
        </div>
        <button className="side-link add-member-toggle" onClick={() => setShowMemberForm((open) => !open)}>
          <span>＋</span>Thêm thành viên bằng email
        </button>
        {showMemberForm && (
          <form className="sidebar-inline-form" onSubmit={addMember}>
            <input
              aria-label="Email thành viên"
              type="email"
              value={memberEmail}
              onChange={(event) => setMemberEmail(event.target.value)}
              placeholder="email@congty.com"
              required
            />
            <input
              aria-label="Tên hiển thị thành viên"
              value={memberName}
              onChange={(event) => setMemberName(event.target.value)}
              placeholder="Tên hiển thị"
              maxLength={80}
            />
            <button type="submit" disabled={busy}>Thêm</button>
          </form>
        )}
        <div className="team-list">
          {members.map((member) => (
            <div className="team-person" key={member.id}>
              <Avatar member={member} size="small" />
              <span title={member.email}>{memberLabel(member)}</span>
              <i />
            </div>
          ))}
        </div>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">☀</div>
            <strong>Cùng nhau giữ nhịp</strong>
            <p>Mỗi bước nhỏ đều đưa cả nhóm tiến gần hơn.</p>
          </div>
          <button
            className="side-link"
            onClick={() => setNotice("Hướng dẫn cấu hình nằm trong HUONG_DAN_CAI_DAT.md.")}
          >
            <span>♡</span>Trợ giúp & hướng dẫn
          </button>
          <button className="side-link" onClick={signOut}>
            <span>↪</span>Đăng xuất
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>{activeWorkspace.name}</span>
            <b>/</b>
            <strong>{view === "board" ? "Tổng quan" : "Tất cả nhiệm vụ"}</strong>
          </div>
          <div className="top-actions">
            <button
              className="icon-button notification-button"
              aria-label="Thông báo"
              onClick={() =>
                setNotice(
                  config.emailConfigured
                    ? "Email nhắc hạn sẽ gửi tới các thành viên được phân công."
                    : "Email chưa cấu hình. Xem HUONG_DAN_CAI_DAT.md để bật nhắc hạn.",
                )
              }
            >
              ♡
              <i />
            </button>
            <div className="user-menu-wrap">
              <button className="user-menu" onClick={() => setMenuOpen((open) => !open)}>
                <Avatar member={currentUser} size="small" />
                <span>
                  <strong>{currentUser?.name}</strong>
                  <small>{session.demo ? "Thành viên dùng thử" : currentUser?.email}</small>
                </span>
                <b>⌄</b>
              </button>
              {menuOpen && (
                <div className="user-dropdown">
                  <button onClick={signOut}>Đăng xuất</button>
                </div>
              )}
            </div>
          </div>
        </header>

        {session.demo && (
          <div className="demo-banner">
            <span>☁</span>
            Bạn đang dùng chế độ thử nghiệm. Không dùng cho dữ liệu nhạy cảm.
          </div>
        )}
        {!config.emailConfigured && (
          <div className="subtle-warning">
            ✉ Email nhắc hạn chưa bật · thêm Gmail App Password trong file .env
          </div>
        )}
        {loadError && (
          <div className="error-banner">
            {loadError}
            <button
              onClick={() => {
                setLoadError("");
                reload();
              }}
            >
              Thử lại
            </button>
          </div>
        )}

        <section className="page-heading">
          <div>
            <span className="eyebrow">{todayLabel}</span>
            <h1>
              Tiến độ của nhóm <span className="heading-sparkle">✿</span>
            </h1>
            <p>Chậm rãi một chút, cùng nhau đi thật xa.</p>
          </div>
          <CatPencilSticker className="heading-cat-sticker" />
          <button
            className="button primary create-button"
            onClick={() => setModalTask("new")}
          >
            <span>＋</span>Tạo nhiệm vụ
          </button>
        </section>

        <section className="stats-row" aria-label="Tổng quan tiến độ">
          <article className="stat-card">
            <div className="stat-icon blue">▦</div>
            <div>
              <small>Tổng nhiệm vụ</small>
              <strong>{tasks.length}</strong>
            </div>
            <span className="stat-note">Trong dự án</span>
          </article>
          <article className="stat-card">
            <div className="stat-icon sky">◷</div>
            <div>
              <small>Đang thực hiện</small>
              <strong>{activeCount}</strong>
            </div>
            <span className="stat-note">Cùng cố gắng</span>
          </article>
          <article className="stat-card">
            <div className="stat-icon mint">✓</div>
            <div>
              <small>Đã hoàn thành</small>
              <strong>{doneCount}</strong>
            </div>
            <span className="stat-note">
              {tasks.length ? `${Math.round((doneCount / tasks.length) * 100)}% tổng việc` : "Bắt đầu thôi"}
            </span>
          </article>
          <article className="stat-card">
            <div className="stat-icon peach">☼</div>
            <div>
              <small>Sắp đến hạn</small>
              <strong>{dueSoonCount}</strong>
            </div>
            <span className="stat-note">Trong 24 giờ</span>
          </article>
        </section>

        <section className="board-toolbar">
          <div className="toolbar-title">
            <h2>Bảng công việc</h2>
            <span>{filteredTasks.length} nhiệm vụ</span>
          </div>
          <div className="toolbar-controls">
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="Tìm nhiệm vụ"
                placeholder="Tìm nhiệm vụ..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <kbd>⌘ K</kbd>
            </label>
            <select
              aria-label="Lọc nhiệm vụ"
              className="filter-select"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">Tất cả</option>
              {statuses.map((item) => (
                <option value={item.key} key={item.key}>{item.label}</option>
              ))}
              {priorities.map((item) => (
                <option value={item.key} key={item.key}>{item.label} ưu tiên</option>
              ))}
            </select>
            <div className="view-switch">
              <button
                aria-label="Dạng bảng"
                className={view === "board" ? "selected" : ""}
                onClick={() => setView("board")}
              >
                ▦
              </button>
              <button
                aria-label="Dạng danh sách"
                className={view === "list" ? "selected" : ""}
                onClick={() => setView("list")}
              >
                ☷
              </button>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="loading-state">
            <div className="spinner" />
            <p>Đang gom những việc cần làm...</p>
          </div>
        ) : view === "board" ? (
          <section className="kanban-board" aria-label="Bảng Kanban">
            {statuses.map((status) => {
              const columnTasks = filteredTasks.filter((task) => task.status === status.key);
              return (
                <div className={`kanban-column column-${status.key.toLowerCase()}`} key={status.key}>
                  <div className="column-heading">
                    <span className={`column-icon ${status.key.toLowerCase()}`}>{status.icon}</span>
                    <h3>{status.label}</h3>
                    <span className="column-count">{columnTasks.length}</span>
                    <span className="column-sticker" aria-hidden="true">
                      {status.key === "DONE" ? "🌟" : status.key === "REVIEW" ? "🧸" : status.key === "IN_PROGRESS" ? "🐣" : "☁️"}
                    </span>
                    <button
                      aria-label={`Tạo nhiệm vụ ${status.label}`}
                      onClick={() => setModalTask("new")}
                    >
                      ＋
                    </button>
                  </div>
                  <div className="column-cards">
                    {columnTasks.map((task) => (
                      <TaskCard
                        task={task}
                        members={members}
                        key={task.id}
                        onOpen={() => setDetailTaskId(task.id)}
                        onStatusChange={(nextStatus) => changeStatus(task.id, nextStatus)}
                      />
                    ))}
                    {columnTasks.length === 0 && (
                      <button
                        className="empty-column"
                        onClick={() => setModalTask("new")}
                      >
                        <span>＋</span> Thêm nhiệm vụ
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        ) : (
          <section className="list-view" aria-label="Danh sách nhiệm vụ">
            {filteredTasks.map((task) => (
              <button
                className="list-row"
                key={task.id}
                onClick={() => setDetailTaskId(task.id)}
              >
                <span
                  className={`column-icon ${task.status.toLowerCase()}`}
                  aria-hidden="true"
                >
                  {statuses.find((item) => item.key === task.status)?.icon}
                </span>
                <strong>{task.title}</strong>
                <span>{statuses.find((item) => item.key === task.status)?.label}</span>
                <span>{memberLabel(members.find((member) => member.id === task.assigneeId))}</span>
                <span
                  className={
                    Date.parse(task.deadline) - Date.now() < 24 * 60 * 60 * 1_000 &&
                    task.status !== "DONE"
                      ? "urgent-text"
                      : ""
                  }
                >
                  {new Date(task.deadline).toLocaleDateString("vi-VN")}
                </span>
              </button>
            ))}
            {filteredTasks.length === 0 && (
              <p className="empty-note">Chưa tìm thấy nhiệm vụ nào phù hợp.</p>
            )}
          </section>
        )}

        <footer className="page-footer">
          <span>☁ Đang đồng bộ theo thời gian thực</span>
          <span><i /> Đã lưu mọi thay đổi</span>
        </footer>
      </main>

      {modalTask && (
        <TaskForm
          task={modalTask === "new" ? undefined : modalTask}
          members={members}
          busy={busy}
          onClose={() => setModalTask(null)}
          onSave={saveTask}
        />
      )}
      {detailTask && session && (
        <TaskDetail
          task={detailTask}
          members={members}
          session={session}
          socket={socket}
          onClose={() => setDetailTaskId(null)}
          onEdit={() => {
            setModalTask(detailTask);
            setDetailTaskId(null);
          }}
          onDataChange={reload}
          onNotice={setNotice}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <span>✓</span>
          {notice}
          <button onClick={() => setNotice("")}>×</button>
        </div>
      )}
    </div>
  );
}
