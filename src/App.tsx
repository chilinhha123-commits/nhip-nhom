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
type MainTab = "board" | "stats" | "members";

type Member = {
  id: string;
  name: string;
  email: string;
  color: string;
  strengths?: string[];
  bioNote?: string;
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

type GroupNotification = {
  id: string;
  message: string;
  senderName: string;
  senderId: string | null;
  createdAt: string;
  emailRecipientCount?: number;
  emailSentCount?: number;
  emailError?: string | null;
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
  reminderAt?: string | null;
  reminderHoursBefore?: number | null;
  remindersSent?: string[];
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
  inviteCode: string;
};

type TaskDraft = Omit<Task, "id" | "createdAt" | "documents" | "comments">;
type PlanMode = "strength_first" | "balance_first";
type AIPlanTask = {
  title: string;
  description: string;
  priority: Priority;
  deadline: string | null;
  assigneeIds: string[];
  assigneeNames: string[];
  assignmentReason: string;
};
type EditablePlanTask = AIPlanTask & { draftId: string };

const memberStrengthOptions = [
  "Lên ý tưởng & Kịch bản",
  "Viết nội dung & Báo cáo",
  "Thiết kế & Hình ảnh",
  "Quay & Dựng video",
  "Làm sản phẩm / Kỹ thuật",
  "Thuyết trình",
  "Tổng hợp & Điều phối",
];

const statuses: { key: Status; label: string }[] = [
  { key: "TODO", label: "Cần làm" },
  { key: "IN_PROGRESS", label: "Đang làm" },
  { key: "REVIEW", label: "Chờ duyệt" },
  { key: "DONE", label: "Hoàn thành" },
];

const priorities: { key: Priority; label: string }[] = [
  { key: "LOW", label: "Thấp" },
  { key: "MEDIUM", label: "Trung bình" },
  { key: "HIGH", label: "Cao" },
];

const reminderTemplates = [
  "Cả nhà ơi cùng kiểm tra lại tiến độ các đầu việc sắp đến hạn nhé 🌿",
  "Mọi người cập nhật trạng thái công việc của mình lên bảng nha!",
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
  timeoutMs = 12_000,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (session.token) headers.set("Authorization", `Bearer ${session.token}`);
  if (session.demo) headers.set("X-Demo-Email", session.user.email);
  if (session.workspaceId) headers.set("X-Workspace-Id", session.workspaceId);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  let response: globalThis.Response;
  try {
    response = await fetch(url, { ...options, headers, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Máy chủ phản hồi chậm. Vui lòng kiểm tra kết nối rồi thử lại.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
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
  if (!member) return "#475569";
  const palette = ["#15803d", "#166534", "#4d7c0f", "#0f766e", "#2563eb"];
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

function RhythmMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 56 56"
      role="img"
      aria-label="Nhịp làm việc nhóm"
    >
      <rect x="3" y="3" width="50" height="50" rx="16" fill="#dcfce7" stroke="#86efac" strokeWidth="2" />
      <path d="M13 29h5l4-9 7 17 5-12 3 4h6" fill="none" stroke="#15803d" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TeamFlowIllustration({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 220 92"
      role="img"
      aria-label="Các thành viên cùng hoàn thành công việc"
    >
      <path d="M39 45h63m17 0h62" stroke="#86efac" strokeWidth="3" strokeLinecap="round" />
      <rect x="10" y="17" width="58" height="56" rx="15" fill="#f0fdf4" stroke="#bbf7d0" strokeWidth="2" />
      <circle cx="39" cy="35" r="8" fill="#15803d" />
      <path d="M25 58c2-9 8-13 14-13s12 4 14 13" fill="#16a34a" />
      <rect x="81" y="17" width="58" height="56" rx="15" fill="#f7fee7" stroke="#d9f99d" strokeWidth="2" />
      <path d="m96 44 8 8 20-21" fill="none" stroke="#4d7c0f" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="152" y="17" width="58" height="56" rx="15" fill="#f0fdfa" stroke="#99f6e4" strokeWidth="2" />
      <circle cx="181" cy="35" r="8" fill="#0f766e" />
      <path d="M167 58c2-9 8-13 14-13s12 4 14 13" fill="#0d9488" />
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
  const overdue = remaining < 0 && task.status !== "DONE";
  const urgent = remaining >= 0 && remaining <= 24 * 60 * 60 * 1_000 && task.status !== "DONE";
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
          <span aria-hidden="true">Trạng thái</span>
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

      <div className={`countdown ${urgent ? "urgent" : ""} ${overdue ? "overdue" : ""}`}>
        <span>{overdue ? "Trễ hạn" : countdown.text}</span>
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
            <span title="Tài liệu">{task.documents.length} tài liệu</span>
          )}
          {task.comments.length > 0 && (
            <span title="Bình luận">{task.comments.length} bình luận</span>
          )}
          <span className={`tiny-status ${status?.key.toLowerCase()}`} title={status?.label}>
            {status?.label}
          </span>
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
  const [reminderMode, setReminderMode] = useState<"hours" | "at">(
    task?.reminderAt ? "at" : "hours",
  );
  const [reminderHoursBefore, setReminderHoursBefore] = useState(
    task?.reminderHoursBefore ?? 24,
  );
  const [reminderAt, setReminderAt] = useState(
    task?.reminderAt
      ? dateInputValue(task.reminderAt)
      : dateInputValue(new Date(Date.now() + 23 * 60 * 60 * 1_000).toISOString()),
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
      setFormError("Cần ít nhất một thành viên để phân công nhiệm vụ.");
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
    if (reminderMode === "at" && !Number.isFinite(Date.parse(reminderAt))) {
      setFormError("Vui lòng chọn giờ báo lại hợp lệ.");
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
        reminderHoursBefore: reminderMode === "hours" ? reminderHoursBefore : null,
        reminderAt: reminderMode === "at" ? new Date(reminderAt).toISOString() : null,
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
          <div className="form-grid">
            <label>
              Cách báo lại
              <select
                value={reminderMode}
                onChange={(event) => setReminderMode(event.target.value as "hours" | "at")}
              >
                <option value="hours">Số giờ trước hạn</option>
                <option value="at">Giờ báo lại cụ thể</option>
              </select>
            </label>
            {reminderMode === "hours" ? (
              <label>
                Báo trước
                <select
                  value={reminderHoursBefore}
                  onChange={(event) => setReminderHoursBefore(Number(event.target.value))}
                >
                  <option value={24}>24 giờ</option>
                  <option value={12}>12 giờ</option>
                  <option value={6}>6 giờ</option>
                  <option value={1}>1 giờ</option>
                  <option value={0}>Đúng giờ đến hạn</option>
                </select>
              </label>
            ) : (
              <label>
                Giờ báo lại
                <input
                  type="datetime-local"
                  value={reminderAt}
                  onChange={(event) => setReminderAt(event.target.value)}
                />
              </label>
            )}
          </div>
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

function MemberStrengthProfile({
  member,
  session,
  workspaceId,
  canEdit,
  onSaved,
}: {
  member: Member;
  session: UserSession;
  workspaceId: string;
  canEdit: boolean;
  onSaved: (members: Member[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [strengths, setStrengths] = useState<string[]>(member.strengths || []);
  const [bioNote, setBioNote] = useState(member.bioNote || "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setStrengths(member.strengths || []);
    setBioNote(member.bioNote || "");
  }, [member]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const updated = await api<Member[]>(
        `/api/workspaces/${workspaceId}/members/${member.id}/profile`,
        session,
        { method: "PUT", body: JSON.stringify({ strengths, bioNote }) },
      );
      onSaved(updated);
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không lưu được hồ sơ điểm mạnh.");
    } finally {
      setPending(false);
    }
  }

  function toggleStrength(strength: string) {
    setStrengths((current) => current.includes(strength)
      ? current.filter((item) => item !== strength)
      : [...current, strength]);
  }

  return (
    <div className="member-profile">
      {!editing ? (
        <>
          <div className="strength-tags">
            {member.strengths?.length
              ? member.strengths.map((strength) => <span className="strength-tag" key={strength}>{strength}</span>)
              : <span className="profile-empty">Chưa cập nhật điểm mạnh</span>}
          </div>
          {member.bioNote && <p className="member-bio">{member.bioNote}</p>}
          {canEdit && (
            <button
              className="profile-edit-button"
              type="button"
              onClick={() => {
                setError("");
                setEditing(true);
              }}
            >
              Cập nhật điểm mạnh
            </button>
          )}
        </>
      ) : (
        <form className="strength-editor" onSubmit={saveProfile}>
          <div className="strength-options" aria-label={`Điểm mạnh của ${member.name}`}>
            {memberStrengthOptions.map((strength) => (
              <button
                type="button"
                key={strength}
                className={`strength-option ${strengths.includes(strength) ? "selected" : ""}`}
                aria-pressed={strengths.includes(strength)}
                onClick={() => toggleStrength(strength)}
              >
                {strength}
              </button>
            ))}
          </div>
          <label>
            Ghi chú ngắn
            <textarea
              value={bioNote}
              onChange={(event) => setBioNote(event.target.value)}
              maxLength={300}
              rows={2}
              placeholder="Kinh nghiệm, thời gian hoặc cách phối hợp..."
            />
          </label>
          {error && <p className="inline-error">{error}</p>}
          <div className="profile-actions">
            <button type="button" className="button secondary compact" onClick={() => setEditing(false)}>
              Huỷ
            </button>
            <button type="submit" className="button primary compact" disabled={pending}>
              {pending ? "Đang lưu..." : "Lưu hồ sơ"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function AIPlanModal({
  session,
  workspaceId,
  members,
  tasks,
  onApply,
  onClose,
}: {
  session: UserSession;
  workspaceId: string;
  members: Member[];
  tasks: Task[];
  onApply: (items: EditablePlanTask[]) => Promise<void>;
  onClose: () => void;
}) {
  const [projectDescription, setProjectDescription] = useState("");
  const [mode, setMode] = useState<PlanMode>("strength_first");
  const [plan, setPlan] = useState<EditablePlanTask[]>([]);
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");

  async function generatePlan(event?: FormEvent) {
    event?.preventDefault();
    setGenerating(true);
    setError("");
    setPlan([]);
    setFallbackUsed(false);
    try {
      const result = await api<{ tasks: AIPlanTask[]; fallbackUsed?: boolean }>(
        `/api/workspaces/${workspaceId}/ai-plan`,
        session,
        {
          method: "POST",
          body: JSON.stringify({
            projectDescription,
            mode,
            existingTasks: tasks.slice(0, 100).map(({ title, status }) => ({ title, status })),
          }),
        },
        15_000,
      );
      setPlan(result.tasks.map((item) => ({ ...item, draftId: crypto.randomUUID() })));
      setFallbackUsed(result.fallbackUsed === true);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Không tạo được kế hoạch bằng AI.");
    } finally {
      setGenerating(false);
    }
  }

  function updateTask(draftId: string, updates: Partial<EditablePlanTask>) {
    setPlan((current) => current.map((item) => item.draftId === draftId ? { ...item, ...updates } : item));
  }

  function toggleAssignee(task: EditablePlanTask, memberId: string) {
    const selected = task.assigneeIds.includes(memberId)
      ? task.assigneeIds.filter((id) => id !== memberId)
      : [...task.assigneeIds, memberId];
    if (selected.length > 3) {
      setError("Mỗi nhiệm vụ có thể chọn tối đa 3 người tham gia.");
      return;
    }
    if (!selected.length) {
      setError("Mỗi nhiệm vụ cần ít nhất một người phụ trách.");
      return;
    }
    setError("");
    updateTask(task.draftId, {
      assigneeIds: selected,
      assigneeNames: selected.map((id) => members.find((member) => member.id === id)?.name || ""),
    });
  }

  async function applyPlan() {
    if (!plan.length) {
      setError("Hãy tạo kế hoạch trước khi áp dụng.");
      return;
    }
    setApplying(true);
    setError("");
    try {
      await onApply(plan);
      onClose();
    } catch (applyError) {
      const message = applyError instanceof Error ? applyError.message : "Không áp dụng được kế hoạch.";
      const partialResult = message.match(/Đã tạo (\d+)\/\d+ nhiệm vụ/);
      if (partialResult) setPlan((current) => current.slice(Number(partialResult[1])));
      setError(message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !generating && !applying) onClose();
      }}
    >
      <section className="dialog ai-plan-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-plan-title">
        <header className="dialog-heading">
          <div>
            <span className="eyebrow">LẬP KẾ HOẠCH NHÓM</span>
            <h2 id="ai-plan-title">AI lập kế hoạch & phân công</h2>
          </div>
          <button className="close-button" onClick={onClose} disabled={generating || applying} aria-label="Đóng">
            ×
          </button>
        </header>
        <form className="ai-plan-form" onSubmit={generatePlan}>
          <label>
            Mô tả dự án / bài tập
            <textarea
              value={projectDescription}
              onChange={(event) => setProjectDescription(event.target.value)}
              maxLength={10_000}
              rows={4}
              placeholder="Mục tiêu, sản phẩm cần nộp, yêu cầu và mốc thời gian (nếu có)..."
              required
            />
          </label>
          <label>
            Cách chia việc
            <select value={mode} onChange={(event) => setMode(event.target.value as PlanMode)}>
              <option value="strength_first">Khớp điểm mạnh + hỗ trợ việc khó</option>
              <option value="balance_first">Ưu tiên người ít việc + hỗ trợ việc khó</option>
            </select>
          </label>
          {error && <p className="inline-error ai-plan-error">{error}</p>}
          <div className="dialog-actions ai-plan-actions">
            {plan.length > 0 && (
              <button type="button" className="button secondary" onClick={() => void generatePlan()} disabled={generating || applying}>
                Tạo lại
              </button>
            )}
            <button type="submit" className="button primary" disabled={generating || applying || projectDescription.trim().length < 10}>
              {generating ? (
                <>
                  <span className="ai-loading-spinner" aria-hidden="true" />
                  AI đang lập kế hoạch (vui lòng đợi 10–25s, không tải lại trang)...
                </>
              ) : "Tạo kế hoạch bằng AI"}
            </button>
          </div>
        </form>
        {plan.length > 0 && (
          <div className="ai-plan-results">
            <div className="ai-plan-results-heading">
              <h3>Đề xuất · {plan.length} đầu việc</h3>
              <span>Chỉnh sửa trước khi đưa vào cột Cần làm</span>
            </div>
            {fallbackUsed && (
              <p className="ai-fallback-note">Đã tạo kế hoạch nhanh theo chế độ dự phòng.</p>
            )}
            {plan.map((item, index) => (
              <article className="ai-plan-task" key={item.draftId}>
                <header className="ai-plan-task-heading">
                  <strong>Đầu việc {index + 1}</strong>
                  <button
                    type="button"
                    className="ai-plan-remove"
                    aria-label={`Xóa đề xuất ${item.title}`}
                    onClick={() => setPlan((current) => current.filter((draft) => draft.draftId !== item.draftId))}
                  >
                    Xóa
                  </button>
                </header>
                <label>
                  Tên nhiệm vụ
                  <input
                    value={item.title}
                    maxLength={120}
                    onChange={(event) => updateTask(item.draftId, { title: event.target.value })}
                  />
                </label>
                <label>
                  Mô tả
                  <textarea
                    value={item.description}
                    maxLength={600}
                    rows={2}
                    onChange={(event) => updateTask(item.draftId, { description: event.target.value })}
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Mức ưu tiên
                    <select
                      value={item.priority}
                      onChange={(event) => updateTask(item.draftId, { priority: event.target.value as Priority })}
                    >
                      {priorities.map((priority) => <option value={priority.key} key={priority.key}>{priority.label}</option>)}
                    </select>
                  </label>
                  <label>
                    Hạn gợi ý
                    <input
                      type="datetime-local"
                      value={item.deadline ? dateInputValue(item.deadline) : ""}
                      onChange={(event) => updateTask(item.draftId, {
                        deadline: event.target.value ? new Date(event.target.value).toISOString() : null,
                      })}
                    />
                  </label>
                </div>
                <fieldset className="ai-assignee-picker">
                  <legend>Người tham gia (chọn 1–3)</legend>
                  <div className="ai-assignee-options">
                    {members.map((member) => (
                      <label key={member.id}>
                        <input
                          type="checkbox"
                          checked={item.assigneeIds.includes(member.id)}
                          onChange={() => toggleAssignee(item, member.id)}
                        />
                        <span>{member.name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <p className="ai-assignment-reason"><strong>Lý do AI:</strong> {item.assignmentReason || "Đề xuất dựa trên thành viên và khối lượng hiện tại."}</p>
              </article>
            ))}
            <div className="dialog-actions ai-plan-actions">
              <button className="button secondary" onClick={onClose} disabled={applying || generating}>Đóng</button>
              <button className="button primary" onClick={() => void applyPlan()} disabled={applying || generating || plan.length === 0}>
                {applying ? "Đang tạo nhiệm vụ..." : "Áp dụng vào Bảng việc"}
              </button>
            </div>
          </div>
        )}
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
  onDelete,
  onDataChange,
  onNotice,
}: {
  task: Task;
  members: Member[];
  session: UserSession;
  socket: Socket | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: (task: Task) => void;
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
              <button
                className="button danger compact"
                onClick={() => {
                  if (window.confirm(`Bạn có chắc muốn xóa nhiệm vụ "${task.title}"?`)) {
                    onDelete(task);
                  }
                }}
              >
                Xóa nhiệm vụ
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
            <span>GIỜ BÁO LẠI</span>
            <strong>
              {task.reminderAt
                ? new Date(task.reminderAt).toLocaleString("vi-VN", {
                    dateStyle: "long",
                    timeStyle: "short",
                  })
                : task.reminderHoursBefore != null
                  ? `Trước hạn ${task.reminderHoursBefore === 0 ? "đúng giờ" : `${task.reminderHoursBefore} giờ`}`
                  : "Mặc định 24 giờ trước hạn"}
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
                      <strong>{member?.name || "Chưa phân công"}</strong>
                      {member?.email && <span className="role-email">{member.email}</span>}
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
          <RhythmMark className="hero-rhythm-mark" />
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
            <TeamFlowIllustration className="preview-team-illustration" />
            <div className="preview-heading">
              <span className="preview-sun">●</span>
              <span>KHÔNG GIAN CỦA BẠN</span>
            </div>
            <div className="preview-empty">
              <span className="preview-checkmark" aria-hidden="true">✓</span>
              <strong>Bắt đầu từ trang trắng</strong>
              <small>Tạo workspace riêng cho nhóm của bạn.</small>
            </div>
          </div>
        </div>
        <div className="login-hero-foot">
          <span>Ít áp lực hơn</span>
          <span>Nhịp nhàng hơn</span>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div className="login-card-mark">
            <RhythmMark className="login-rhythm-icon" />
          </div>
          <span className="eyebrow">CHÀO MỪNG BẠN</span>
          <h2>Đăng nhập vào Nhịp Nhóm</h2>
          <p className="login-subtitle">Tiếp tục làm việc vui vẻ cùng nhóm của bạn.</p>

          <div className="google-login">
            {config.googleClientId ? (
              <GoogleLogin
                width={String(googleButtonWidth)}
                theme="outline"
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

function mergeNotifications(
  current: GroupNotification[],
  incoming: GroupNotification[],
): GroupNotification[] {
  const unique = new Map<string, GroupNotification>();
  for (const notification of [...current, ...incoming]) unique.set(notification.id, notification);
  return [...unique.values()]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 100);
}

function GroupNotificationsPanel({
  session,
  workspaceId,
  notifications,
  loading,
  loadError,
  onClose,
  onSent,
}: {
  session: UserSession;
  workspaceId: string;
  notifications: GroupNotification[];
  loading: boolean;
  loadError: string;
  onClose: () => void;
  onSent: (notification: GroupNotification) => void;
}) {
  const [message, setMessage] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("custom");
  const [anonymous, setAnonymous] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [confirmationError, setConfirmationError] = useState(false);

  useEffect(() => {
    if (!confirmation) return;
    const timeout = window.setTimeout(() => setConfirmation(""), 4_000);
    return () => window.clearTimeout(timeout);
  }, [confirmation]);

  async function sendReminder(event: FormEvent) {
    event.preventDefault();
    if (!message.trim()) {
      setError("Hãy nhập lời nhắc trước khi gửi.");
      return;
    }
    setSending(true);
    setError("");
    setConfirmation("");
    setConfirmationError(false);
    try {
      const saved = await api<GroupNotification>(
        `/api/workspaces/${workspaceId}/notifications`,
        session,
        { method: "POST", body: JSON.stringify({ message: message.trim(), anonymous }) },
        10_000,
      );
      onSent(saved);
      const emailSent = (saved.emailRecipientCount ?? 0) > 0
        && saved.emailSentCount === saved.emailRecipientCount;
      setConfirmationError(!emailSent);
      setConfirmation(emailSent
        ? "Đã gửi lời nhắc qua email tới cả nhóm!"
        : "Đã lưu lời nhắc trong nhóm, nhưng chưa gửi được email.");
      setMessage("");
      setSelectedTemplate("custom");
    } catch {
      setError("Chưa gửi được lời nhắc. Vui lòng thử lại.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !sending) onClose();
      }}
    >
      <section className="dialog group-notifications-dialog" role="dialog" aria-modal="true" aria-labelledby="notifications-title">
        <header className="dialog-heading">
          <div>
            <span className="eyebrow">KHÔNG GIAN NHÓM</span>
            <h2 id="notifications-title">Thông báo</h2>
          </div>
          <button className="close-button" onClick={onClose} disabled={sending} aria-label="Đóng">
            ×
          </button>
        </header>

        <section className="notification-compose">
          <div className="notification-section-heading">
            <h3>Gửi lời nhắc nhẹ nhàng tới cả nhóm</h3>
            <p>Sẽ gửi thông báo qua Email tới toàn bộ thành viên</p>
          </div>
          <form className="notification-form" onSubmit={sendReminder}>
            <label>
              Mẫu lời nhắn
              <select
                value={selectedTemplate}
                onChange={(event) => {
                  const value = event.target.value;
                  setSelectedTemplate(value);
                  if (value !== "custom") setMessage(value);
                }}
              >
                <option value="custom">Tự viết lời nhắn</option>
                {reminderTemplates.map((template) => (
                  <option value={template} key={template}>{template}</option>
                ))}
              </select>
            </label>
            <label>
              Nội dung lời nhắc
              <textarea
                value={message}
                onChange={(event) => {
                  setMessage(event.target.value);
                  setSelectedTemplate("custom");
                }}
                maxLength={500}
                rows={3}
                placeholder="Viết lời nhắn ngắn, tích cực cho cả nhóm..."
                required
              />
            </label>
            <label className="notification-anonymous">
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(event) => setAnonymous(event.target.checked)}
              />
              <span>Gửi ẩn danh <small>(hiển thị là “Một thành viên trong nhóm”)</small></span>
            </label>
            {(error || loadError) && <p className="inline-error">{error || loadError}</p>}
            <button type="submit" className="button primary" disabled={sending || !message.trim()}>
              {sending ? "Đang gửi..." : "Gửi thông báo cho mọi người"}
            </button>
            {confirmation && (
              <p className={`notification-send-result${confirmationError ? " is-error" : ""}`} role="status">
                {confirmation}
              </p>
            )}
          </form>
        </section>

        <section className="notification-history">
          <div className="notification-section-heading">
            <h3>Lời nhắn gần đây</h3>
            <span>{notifications.length}</span>
          </div>
          {loading ? (
            <p className="notification-empty">Đang tải thông báo...</p>
          ) : notifications.length ? (
            <div className="notification-list">
              {notifications.map((notification) => (
                <article className="notification-item" key={notification.id}>
                  <p>{notification.message}</p>
                  <div>
                    <strong>{notification.senderName}</strong>
                    <time>{new Date(notification.createdAt).toLocaleString("vi-VN", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}</time>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="notification-empty">Chưa có lời nhắn nào trong workspace.</p>
          )}
        </section>
      </section>
    </div>
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
  const [showAiPlan, setShowAiPlan] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<GroupNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsLoadError, setNotificationsLoadError] = useState("");
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"board" | "list">("board");
  const [mainTab, setMainTab] = useState<MainTab>("board");
  const [menuOpen, setMenuOpen] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const browserReminderKeys = useRef(new Set<string>());
  const [statsNow, setStatsNow] = useState(Date.now());
  const [workspaceName, setWorkspaceName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberName, setMemberName] = useState("");
  const [showWorkspaceForm, setShowWorkspaceForm] = useState(false);
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
    connection.on("workspace:notification", (notification: GroupNotification) => {
      setNotifications((current) => mergeNotifications(current, [notification]));
      setNotice(`Lời nhắc nhóm: ${notification.message}`);
    });
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

  useEffect(() => {
    const timer = window.setInterval(() => setStatsNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!tasks.length) return;

    const checkBrowserReminders = () => {
      const now = Date.now();
      for (const task of tasks) {
        if (task.status === "DONE") continue;

        let reminderTime: number;
        if (task.reminderAt) {
          reminderTime = Date.parse(task.reminderAt);
        } else if (task.reminderHoursBefore != null) {
          const deadlineTime = Date.parse(task.deadline);
          reminderTime = deadlineTime - Number(task.reminderHoursBefore) * 60 * 60 * 1000;
        } else {
          reminderTime = Date.parse(task.deadline) - 24 * 60 * 60 * 1000;
        }

        if (!Number.isFinite(reminderTime)) continue;
        const elapsed = now - reminderTime;
        if (elapsed < 0 || elapsed > 30 * 60 * 1000) continue;

        const key = `${task.id}:${reminderTime}`;
        if (browserReminderKeys.current.has(key)) continue;
        browserReminderKeys.current.add(key);
        setNotice(`⏰ Đến giờ báo lại: "${task.title}"`);

        try {
          const AudioContextClass = window.AudioContext
            || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!AudioContextClass) continue;
          const context = new AudioContextClass();
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = "sine";
          oscillator.frequency.value = 660;
          gain.gain.setValueAtTime(0.035, context.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.16);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start();
          oscillator.stop(context.currentTime + 0.16);
          oscillator.onended = () => void context.close();
        } catch {
          // Trình duyệt có thể chặn âm thanh tự động; toast vẫn hiển thị bình thường.
        }
      }
    };

    checkBrowserReminders();
    const timer = window.setInterval(checkBrowserReminders, 30_000);
    return () => window.clearInterval(timer);
  }, [tasks]);

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
  const inProgressCount = tasks.filter((task) => task.status === "IN_PROGRESS").length;
  const todoCount = tasks.filter((task) => task.status === "TODO").length;
  const dueSoonCount = tasks.filter((task) => {
    const remaining = Date.parse(task.deadline) - statsNow;
    return task.status !== "DONE" && remaining >= 0 && remaining <= 24 * 60 * 60 * 1_000;
  }).length;
  const overdueTasks = tasks.filter(
    (task) => task.status !== "DONE" && Date.parse(task.deadline) < statsNow,
  );
  const reviewCount = tasks.filter((task) => task.status === "REVIEW").length;
  const unassignedCount = tasks.filter(
    (task) => !task.assigneeId || !members.some((member) => member.id === task.assigneeId),
  ).length;
  const completionPercent = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;
  const completedShare = tasks.length ? (doneCount / tasks.length) * 100 : 0;
  const inProgressShare = tasks.length ? (inProgressCount / tasks.length) * 100 : 0;
  const reviewShare = tasks.length ? (reviewCount / tasks.length) * 100 : 0;
  const todoShare = tasks.length ? (todoCount / tasks.length) * 100 : 0;
  const completedEnd = completedShare;
  const inProgressEnd = completedEnd + inProgressShare;
  const reviewEnd = inProgressEnd + reviewShare;
  const attentionTasks = tasks
    .filter((task) => {
      if (task.status === "DONE") return false;
      const remaining = Date.parse(task.deadline) - statsNow;
      return remaining < 0 || (remaining >= 0 && remaining <= 24 * 60 * 60 * 1_000);
    })
    .sort((left, right) => Date.parse(left.deadline) - Date.parse(right.deadline));
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
    const editingTask = modalTask && modalTask !== "new" ? modalTask : null;
    const optimisticId = editingTask?.id || `temp-task-${crypto.randomUUID()}`;
    const optimisticTask: Task = editingTask
      ? { ...editingTask, ...draft }
      : {
          ...draft,
          id: optimisticId,
          createdAt: new Date().toISOString(),
          documents: [],
          comments: [],
          remindersSent: [],
        };

    setTasks((current) =>
      editingTask
        ? current.map((item) => (item.id === editingTask.id ? optimisticTask : item))
        : [optimisticTask, ...current.filter((item) => item.id !== optimisticId)],
    );
    setModalTask(null);
    setBusy(false);
    setNotice("Đang lưu nhiệm vụ...");

    void (async () => {
      try {
        const result = await api<{ task: Task; warnings: string[] }>(
        editingTask ? `/api/tasks/${editingTask.id}` : "/api/tasks",
        session,
        {
          method: editingTask ? "PUT" : "POST",
          body: JSON.stringify(draft),
        },
        );
        setTasks((current) =>
          editingTask
            ? current.map((item) => (item.id === editingTask.id ? result.task : item))
            : [result.task, ...current.filter((item) => item.id !== optimisticId)],
        );
        setNotice(
          result.warnings?.length
            ? result.warnings.join(" ")
            : "Đã lưu nhiệm vụ thật gọn gàng!",
        );
      } catch (error) {
        setTasks((current) =>
          editingTask
            ? current.map((item) => (item.id === editingTask.id ? editingTask : item))
            : current.filter((item) => item.id !== optimisticId),
        );
        setNotice(error instanceof Error ? error.message : "Không lưu được nhiệm vụ.");
      }
    })();
  }

  async function applyAiPlan(items: EditablePlanTask[]) {
    if (!session) throw new Error("Bạn cần đăng nhập để áp dụng kế hoạch.");
    const invalidItem = items.find((item) =>
      !item.title.trim()
      || !item.assigneeIds.some((id) => members.some((member) => member.id === id)));
    if (invalidItem) {
      throw new Error(`Đầu việc "${invalidItem.title || "chưa có tên"}" cần tên và ít nhất một người phụ trách.`);
    }
    let createdCount = 0;
    for (const item of items) {
      const assignees = item.assigneeIds.filter((id) => members.some((member) => member.id === id)).slice(0, 3);
      const deadlineTime = item.deadline ? Date.parse(item.deadline) : NaN;
      const draft: TaskDraft = {
        title: item.title.trim(),
        description: item.description.trim(),
        status: "TODO",
        priority: item.priority,
        assigneeId: assignees[0],
        supporterId: assignees[1] || assignees[0],
        reviewerId: assignees[2] || assignees[1] || assignees[0],
        deadline: Number.isFinite(deadlineTime)
          ? new Date(deadlineTime).toISOString()
          : new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
        reminderAt: null,
        reminderHoursBefore: null,
      };
      try {
        const result = await api<{ task: Task; warnings: string[] }>("/api/tasks", session, {
          method: "POST",
          body: JSON.stringify(draft),
        });
        setTasks((current) => [result.task, ...current.filter((task) => task.id !== result.task.id)]);
        createdCount += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Không lưu được nhiệm vụ.";
        if (createdCount) {
          setNotice(`Đã tạo ${createdCount}/${items.length} nhiệm vụ; phần còn lại chưa được lưu.`);
          throw new Error(`Đã tạo ${createdCount}/${items.length} nhiệm vụ. ${reason}`);
        }
        throw error;
      }
    }
    setNotice(`Đã áp dụng kế hoạch và tạo ${createdCount} nhiệm vụ vào cột Cần làm.`);
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

  async function deleteTask(task: Task) {
    if (!session) return;
    setTasks((current) => current.filter((item) => item.id !== task.id));
    setDetailTaskId(null);
    try {
      await api<void>(`/api/tasks/${task.id}`, session, { method: "DELETE" });
      setNotice(`Đã xóa nhiệm vụ "${task.title}".`);
    } catch (error) {
      setTasks((current) => current.some((item) => item.id === task.id)
        ? current
        : [task, ...current]);
      setNotice(error instanceof Error ? error.message : "Không xóa được nhiệm vụ.");
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

  async function joinWorkspace(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setLoadError("");
    try {
      const workspace = await api<Workspace>("/api/workspaces/join", session, {
        method: "POST",
        body: JSON.stringify({ code: joinCode }),
      });
      const nextSession = { ...session, workspaceId: workspace.id };
      localStorage.setItem("nhip-nhom-user", JSON.stringify(nextSession));
      setSession(nextSession);
      setWorkspaces((current) => current.some((item) => item.id === workspace.id)
        ? current
        : [...current, workspace]);
      setJoinCode("");
      setLoading(true);
      setNotice(`Đã tham gia nhóm "${workspace.name}".`);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Không tham gia được nhóm.");
    } finally {
      setBusy(false);
    }
  }

  async function copyInviteCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setNotice(`Đã sao chép mã mời ${code}.`);
    } catch {
      setNotice("Không thể sao chép mã tự động. Hãy chọn và sao chép mã hiển thị.");
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
      setNotice("Đã thêm email vào workspace. Thành viên có thể đăng nhập bằng địa chỉ này.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thêm được thành viên.");
    } finally {
      setBusy(false);
    }
  }

  async function openNotifications() {
    if (!session?.workspaceId) return;
    setShowNotifications(true);
    setNotificationsLoading(true);
    setNotificationsLoadError("");
    try {
      const saved = await api<GroupNotification[]>(
        `/api/workspaces/${session.workspaceId}/notifications`,
        session,
      );
      setNotifications((current) => mergeNotifications(current, saved));
    } catch (error) {
      setNotificationsLoadError(error instanceof Error ? error.message : "Không tải được thông báo.");
    } finally {
      setNotificationsLoading(false);
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
    setShowAiPlan(false);
    setShowNotifications(false);
    setNotifications([]);
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
    setShowAiPlan(false);
    setShowNotifications(false);
    setNotifications([]);
  }

  const activeWorkspace = workspaces.find((workspace) => workspace.id === session?.workspaceId);
  const completedTasks = tasks.filter((task) => task.status === "DONE").length;
  const memberContributions = members.map((member) => {
    const assignedTasks = tasks.filter((task) => task.assigneeId === member.id);
    const completedByMember = assignedTasks.filter((task) => task.status === "DONE").length;
    return {
      member,
      assigned: assignedTasks.length,
      completed: completedByMember,
      contribution: completedTasks ? Math.round((completedByMember / completedTasks) * 100) : 0,
      role: activeWorkspace?.ownerId === member.id ? "Trưởng nhóm" : "Thành viên",
    };
  });

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
          <span className="eyebrow">CHÀO {currentUser?.name.toLocaleUpperCase("vi-VN")}</span>
          <h1>Tạo workspace hoặc tham gia nhóm</h1>
          <p>
            Workspace mới bắt đầu hoàn toàn trống. Bạn có thể tạo bảng riêng và thêm thành viên
            bằng email, hoặc tham gia nhóm khác bằng mã mời.
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
          <div className="workspace-join-divider">HOẶC THAM GIA NHÓM</div>
          <form onSubmit={joinWorkspace} className="workspace-create-form workspace-join-form">
            <label htmlFor="workspace-invite-code">Mã mời nhóm</label>
            <input
              id="workspace-invite-code"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value)}
              placeholder="Ví dụ: A1B2C3D4"
              maxLength={16}
              autoComplete="off"
              required
            />
            <button type="submit" className="button secondary" disabled={busy}>
              {busy ? "Đang tham gia..." : "Tham gia nhóm"}
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

        <div className="sidebar-bottom">
          <button
            className="side-link"
            onClick={() => setNotice("Hướng dẫn cấu hình nằm trong HUONG_DAN_CAI_DAT.md.")}
          >
            Trợ giúp & hướng dẫn
          </button>
          <button className="side-link" onClick={signOut}>Đăng xuất</button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>{activeWorkspace.name}</span>
            <b>/</b>
            <strong>
              {mainTab === "board" ? "Bảng việc" : mainTab === "stats" ? "Thống kê" : "Thành viên"}
            </strong>
          </div>
          <div className="top-actions">
            <button
              className="button secondary compact notification-button"
              onClick={() => void openNotifications()}
            >
              Thông báo{notifications.length ? ` (${notifications.length})` : ""}
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
            Bạn đang dùng chế độ thử nghiệm. Không dùng cho dữ liệu nhạy cảm.
          </div>
        )}
        {!config.emailConfigured && (
          <div className="subtle-warning">
            Email nhắc hạn chưa bật · thêm BREVO_API_KEY hoặc Gmail App Password
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
            <h1>{mainTab === "board" ? "Bảng việc nhóm" : mainTab === "stats" ? "Thống kê dự án" : "Thành viên nhóm"}</h1>
            <p>{activeWorkspace.name}</p>
          </div>
          {mainTab === "board" && (
            <div className="page-heading-actions">
              <button className="button secondary ai-plan-open-button" onClick={() => setShowAiPlan(true)}>
                AI lập kế hoạch
              </button>
              <button className="button primary create-button" onClick={() => setModalTask("new")}>
                + Tạo nhiệm vụ
              </button>
            </div>
          )}
        </section>

        <nav className="workspace-tabs" role="tablist" aria-label="Khu vực workspace">
          {([
            ["board", "Bảng việc"],
            ["stats", "Thống kê"],
            ["members", "Thành viên"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              id={`workspace-tab-${key}`}
              className={`workspace-tab ${mainTab === key ? "active" : ""}`}
              role="tab"
              aria-selected={mainTab === key}
              aria-controls={`workspace-panel-${key}`}
              onClick={() => setMainTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>

        {loading ? (
          <div className="loading-state">
            <div className="spinner" />
            <p>Đang tải dữ liệu nhóm...</p>
          </div>
        ) : mainTab === "board" ? (
          <div id="workspace-panel-board" role="tabpanel" aria-labelledby="workspace-tab-board">
          <section className="board-toolbar">
          <div className="toolbar-title">
            <h2>{view === "board" ? "Bảng công việc" : "Danh sách công việc"}</h2>
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

          {view === "board" ? (
          <section className="kanban-board" aria-label="Bảng Kanban">
            {statuses.map((status) => {
              const columnTasks = filteredTasks.filter((task) => task.status === status.key);
              return (
                <div className={`kanban-column column-${status.key.toLowerCase()}`} key={status.key}>
                  <div className="column-heading">
                    <h3>{status.label}</h3>
                    <span className="column-count">{columnTasks.length}</span>
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
        </div>
        ) : mainTab === "stats" ? (
          <div id="workspace-panel-stats" className="stats-dashboard" role="tabpanel" aria-labelledby="workspace-tab-stats">
            <section className="stats-top-grid">
              <article className="data-panel progress-panel">
                <header className="panel-heading">
                  <h2>Tiến độ dự án</h2>
                  <span>{tasks.length} đầu việc</span>
                </header>
                <div className="progress-summary">
                  <div
                    className="progress-donut"
                    role="img"
                    aria-label={`${completionPercent}% hoàn thành`}
                    style={{
                      background: `conic-gradient(#15803d 0% ${completedEnd}%, #4d7c0f ${completedEnd}% ${inProgressEnd}%, #0f766e ${inProgressEnd}% ${reviewEnd}%, #d97706 ${reviewEnd}% ${reviewEnd + todoShare}%, #e5e7eb ${reviewEnd + todoShare}% 100%)`,
                    }}
                  >
                    <div className="progress-donut-center">
                      <strong>{completionPercent}%</strong>
                      <span>hoàn thành</span>
                    </div>
                  </div>
                </div>
                <div className="status-legend">
                  {statuses.map((status) => {
                    const count = tasks.filter((task) => task.status === status.key).length;
                    return (
                      <div className={`legend-item legend-${status.key.toLowerCase()}`} key={status.key}>
                        <span className="legend-dot" />
                        <span>{status.label}</span>
                        <strong>{count}</strong>
                      </div>
                    );
                  })}
                </div>
              </article>
              <section className="stats-kpi-grid" aria-label="Chỉ số dự án">
                {[
                  ["Tổng đầu việc", tasks.length, ""],
                  ["Đã hoàn thành", doneCount, "kpi-completed"],
                  ["Đang chờ duyệt", reviewCount, "kpi-review"],
                  ["Trễ hạn", overdueTasks.length, "kpi-overdue"],
                  ["Sắp đến hạn (24h)", dueSoonCount, "kpi-due-soon"],
                  ["Chưa giao", unassignedCount, "kpi-unassigned"],
                ].map(([label, count, className]) => (
                  <article className={`kpi-card ${className}`} key={label}>
                    <span>{label}</span>
                    <strong>{count}</strong>
                  </article>
                ))}
              </section>
            </section>
            <section className="stats-bottom-grid">
              <article className="data-panel contribution-panel">
                <header className="panel-heading">
                  <h2>Đóng góp từng thành viên</h2>
                  <span>{members.length} thành viên</span>
                </header>
                <div className="contribution-list">
                  {memberContributions.map(({ member, assigned, completed, contribution, role }) => (
                    <div className="contribution-row" key={member.id}>
                      <Avatar member={member} size="small" />
                      <div className="contribution-member">
                        <strong>{member.name}</strong>
                        <small>{role}</small>
                      </div>
                      <span className="contribution-count">{completed} / {assigned} xong</span>
                      <strong className="contribution-percent">{contribution}%</strong>
                    </div>
                  ))}
                  {members.length === 0 && <p className="empty-note">Chưa có thành viên.</p>}
                </div>
              </article>
              <article className="data-panel attention-panel">
                <header className="panel-heading">
                  <h2>Cần chú ý</h2>
                  <span>{attentionTasks.length} nhiệm vụ</span>
                </header>
                <div className="attention-list">
                  {attentionTasks.map((task) => {
                    const remaining = Date.parse(task.deadline) - statsNow;
                    const warning = remaining < 0
                      ? `Trễ ${Math.max(1, Math.ceil(Math.abs(remaining) / 86_400_000))} ngày`
                      : `Còn ${Math.max(1, Math.ceil(remaining / 3_600_000))} giờ`;
                    return (
                      <button
                        className={`attention-row ${remaining < 0 ? "overdue" : ""}`}
                        key={task.id}
                        onClick={() => setDetailTaskId(task.id)}
                      >
                        <span className="attention-task">
                          <strong>{task.title}</strong>
                          <small>{members.find((member) => member.id === task.assigneeId)?.name || "Chưa giao"}</small>
                        </span>
                        <span className="attention-badge">{warning}</span>
                      </button>
                    );
                  })}
                  {attentionTasks.length === 0 && <p className="empty-note">Không có nhiệm vụ cần chú ý.</p>}
                </div>
              </article>
            </section>
          </div>
        ) : (
          <div id="workspace-panel-members" className="members-page" role="tabpanel" aria-labelledby="workspace-tab-members">
            <section className="data-panel invite-panel">
              <div>
                <span className="panel-overline">MÃ MỜI NHÓM</span>
                <strong className="invite-code">{activeWorkspace.inviteCode}</strong>
              </div>
              <button className="button secondary" onClick={() => void copyInviteCode(activeWorkspace.inviteCode)}>
                Sao chép mã
              </button>
            </section>
            <section className="data-panel member-management">
              <header className="panel-heading">
                <div>
                  <h2>Thành viên</h2>
                  <p>{members.length} thành viên trong nhóm</p>
                </div>
              </header>
              <form className="member-add-form" onSubmit={addMember}>
                <label>
                  Email
                  <input
                    type="email"
                    value={memberEmail}
                    onChange={(event) => setMemberEmail(event.target.value)}
                    placeholder="email@congty.com"
                    required
                  />
                </label>
                <label>
                  Tên hiển thị
                  <input
                    value={memberName}
                    onChange={(event) => setMemberName(event.target.value)}
                    placeholder="Tự lấy từ email nếu để trống"
                    maxLength={80}
                  />
                </label>
                <button className="button primary" type="submit" disabled={busy}>
                  {busy ? "Đang thêm..." : "Thêm thành viên"}
                </button>
              </form>
              <div className="member-table" role="table" aria-label="Danh sách thành viên">
                <div className="member-table-header" role="row">
                  <span>Thành viên</span><span>Vai trò</span><span>Email</span><span>Đầu việc</span>
                </div>
                {memberContributions.map(({ member, assigned, completed, role }) => (
                  <div className="member-record" key={member.id}>
                    <div className="member-table-row" role="row">
                      <div className="member-name-cell">
                        <Avatar member={member} size="small" />
                        <strong>{member.name}</strong>
                      </div>
                      <span>{role}</span>
                      <span className="member-email">{member.email}</span>
                      <span>{assigned} tổng · {completed} xong</span>
                    </div>
                    <MemberStrengthProfile
                      member={member}
                      session={session}
                      workspaceId={activeWorkspace.id}
                      canEdit={currentUser?.id === member.id || currentUser?.id === activeWorkspace.ownerId}
                      onSaved={setMembers}
                    />
                  </div>
                ))}
                {members.length === 0 && <p className="empty-note">Chưa có thành viên.</p>}
              </div>
            </section>
          </div>
        )}

        <footer className="page-footer">
          <span>Đang đồng bộ theo thời gian thực</span>
          <span>Đã lưu mọi thay đổi</span>
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
      {showAiPlan && session && activeWorkspace && (
        <AIPlanModal
          session={session}
          workspaceId={activeWorkspace.id}
          members={members}
          tasks={tasks}
          onApply={applyAiPlan}
          onClose={() => setShowAiPlan(false)}
        />
      )}
      {showNotifications && session && activeWorkspace && (
        <GroupNotificationsPanel
          session={session}
          workspaceId={activeWorkspace.id}
          notifications={notifications}
          loading={notificationsLoading}
          loadError={notificationsLoadError}
          onClose={() => setShowNotifications(false)}
          onSent={(notification) => {
            setNotifications((current) => mergeNotifications(current, [notification]));
            const emailSent = (notification.emailRecipientCount ?? 0) > 0
              && notification.emailSentCount === notification.emailRecipientCount;
            setNotice(emailSent
              ? "Đã gửi lời nhắc qua email tới cả nhóm!"
              : "Đã lưu lời nhắc trong nhóm, nhưng chưa gửi được email.");
          }}
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
          onDelete={deleteTask}
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
