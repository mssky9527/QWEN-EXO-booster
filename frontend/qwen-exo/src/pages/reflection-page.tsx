import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BrainCircuit,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Link2,
  LoaderCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiError,
  cancelPendingReflections,
  getReflectionRegenerationStatus,
  getReflectionSource,
  listPendingReflectionMemories,
  listReflectionMemories,
  regenerateReflectionMemory,
  startPendingReflections,
} from "@/lib/api";
import { translate as t } from "@/lib/i18n";
import type {
  PendingReflectionMemory,
  ReflectionMemoryRecord,
  ReflectionRegenerationJobStatus,
  ReflectionSourceDetail,
} from "@/lib/types";
import { cn, formatNumber, formatTime } from "@/lib/utils";

const REGENERATION_STEPS = [
  "读取轨迹",
  "Q×K 检索",
  "模型反思",
  "替换与编译",
  "完成",
];

const INITIAL_REGENERATION: ReflectionRegenerationJobStatus = {
  job_id: null,
  status: "idle",
  stage: "idle",
  progress: 0,
  message: "尚未开始重新反思",
  details: {},
  result: null,
  error: null,
};

const OUTCOME_LABELS: Record<ReflectionMemoryRecord["outcome"], string> = {
  success: "成功",
  failure: "失败",
  mixed: "部分完成",
  uncertain: "未确定",
};

const REGENERATION_STATUS_LABELS: Record<
  ReflectionRegenerationJobStatus["status"],
  string
> = {
  idle: "未运行",
  queued: "已排队",
  running: "后台运行中",
  succeeded: "已完成",
  failed: "失败",
};

function remainingLabel(item: PendingReflectionMemory, now: number) {
  if (item.status === "running") return t("整理中");
  const seconds = Math.max(0, Math.ceil(item.due_at - now));
  if (!seconds) return t("即将开始");
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (!minutes) return t("{count} 秒", { count: formatNumber(rest) });
  return rest
    ? t("{minutes} 分 {seconds} 秒", {
        minutes: formatNumber(minutes),
        seconds: formatNumber(rest),
      })
    : t("{count} 分", { count: formatNumber(minutes) });
}

function outcomeVariant(outcome: ReflectionMemoryRecord["outcome"]) {
  if (outcome === "success") return "success" as const;
  if (outcome === "failure") return "destructive" as const;
  if (outcome === "mixed") return "warning" as const;
  return "outline" as const;
}

function regenerationStepIndex(status: ReflectionRegenerationJobStatus) {
  if (status.status === "succeeded" || status.stage === "completed") return 4;
  if (status.stage === "publishing") return 3;
  if (status.stage === "model_review") return 2;
  if (status.stage === "qk_retrieval") return 1;
  if (status.stage === "loading_source" || status.stage === "queued") return 0;
  if (status.status === "failed") {
    return Math.min(3, Math.max(0, Math.floor(status.progress / 20)));
  }
  return -1;
}

function memoryTextSections(memory: ReflectionMemoryRecord) {
  return [
    ["反思", memory.reflection],
    ["证据", memory.evidence],
    ["因果分析", memory.causal_analysis],
    ["冲突与边界", memory.conflict_resolution],
    ["可复用经验", memory.reusable_experience],
    ["应避免", memory.avoid],
    ["下一次", memory.next_time],
  ] as const;
}

export function ReflectionPage() {
  const [memories, setMemories] = useState<ReflectionMemoryRecord[]>([]);
  const [pending, setPending] = useState<PendingReflectionMemory[]>([]);
  const [regeneration, setRegeneration] =
    useState<ReflectionRegenerationJobStatus>(INITIAL_REGENERATION);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [memoryQuery, setMemoryQuery] = useState("");
  const [pendingQuery, setPendingQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [action, setAction] = useState<"start" | "cancel" | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [summaryConversationKey, setSummaryConversationKey] = useState<
    string | null
  >(null);
  const [memoryDetail, setMemoryDetail] =
    useState<ReflectionMemoryRecord | null>(null);
  const [regenerateTarget, setRegenerateTarget] =
    useState<ReflectionMemoryRecord | null>(null);
  const [sourceDetail, setSourceDetail] =
    useState<ReflectionSourceDetail | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [verifierFeedback, setVerifierFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const notifiedJob = useRef<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [memoryResult, pendingResult, regenerationResult] =
        await Promise.all([
          listReflectionMemories(),
          listPendingReflectionMemories(),
          getReflectionRegenerationStatus(),
        ]);
      setAvailable(true);
      setMemories(memoryResult.reflections || []);
      setPending(pendingResult.pending || []);
      setRegeneration(regenerationResult);
      const availableKeys = new Set(
        (pendingResult.pending || []).map((item) => item.conversation_key),
      );
      setSelected(
        (current) =>
          new Set([...current].filter((key) => availableKeys.has(key))),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setAvailable(false);
        setMemories([]);
        setPending([]);
        setSelected(new Set());
      } else if (!silent) {
        toast.error(t("反思记忆加载失败"), {
          description: error instanceof Error ? error.message : t("未知错误"),
        });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refreshTimer = window.setInterval(() => void load(true), 1500);
    const clockTimer = window.setInterval(
      () => setNow(Date.now() / 1000),
      1000,
    );
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, [load]);

  useEffect(() => {
    if (!regeneration.job_id || notifiedJob.current === regeneration.job_id)
      return;
    if (regeneration.status === "succeeded") {
      notifiedJob.current = regeneration.job_id;
      toast.success(t("重新反思完成"), {
        description: t("关联记忆已替换并完成 Tensor Bank 热编译。"),
      });
      void load(true);
    } else if (regeneration.status === "failed") {
      notifiedJob.current = regeneration.job_id;
      toast.error(t("重新反思失败"), {
        description: regeneration.error || regeneration.message,
      });
    }
  }, [load, regeneration]);

  const visibleMemories = useMemo(() => {
    const needle = memoryQuery.trim().toLowerCase();
    if (!needle) return memories;
    return memories.filter((item) =>
      [
        item.title,
        item.trajectory_id,
        item.conversation_key,
        item.source_digest,
        item.document_path,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [memories, memoryQuery]);

  const visiblePending = useMemo(() => {
    const needle = pendingQuery.trim().toLowerCase();
    if (!needle) return pending;
    return pending.filter((item) =>
      [
        item.original_task,
        item.trajectory_id,
        item.conversation_key,
        item.source_digest,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [pending, pendingQuery]);

  const visibleKeys = visiblePending.map((item) => item.conversation_key);
  const allVisibleSelected =
    visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key));
  const someVisibleSelected = visibleKeys.some((key) => selected.has(key));
  const selectedItems = pending.filter((item) =>
    selected.has(item.conversation_key),
  );
  const selectedHasRunning = selectedItems.some(
    (item) => item.status === "running",
  );
  const summaryItem = pending.find(
    (item) => item.conversation_key === summaryConversationKey,
  );
  const regenerating =
    regeneration.status === "queued" || regeneration.status === "running";
  const activeRegenerationStep = regenerationStepIndex(regeneration);

  const toggleAll = () => {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleKeys.forEach((key) => next.delete(key));
      else visibleKeys.forEach((key) => next.add(key));
      return next;
    });
  };

  const toggleOne = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const startNow = async (keys: string[]) => {
    if (!keys.length) return;
    setAction("start");
    try {
      const result = await startPendingReflections(keys);
      setSelected(new Set());
      toast.success(
        t("已开始 {count} 条反思", {
          count: formatNumber(result.started_count),
        }),
      );
      await load(true);
    } catch (error) {
      toast.error(t("立即反思失败"), {
        description: error instanceof Error ? error.message : t("未知错误"),
      });
    } finally {
      setAction(null);
    }
  };

  const cancel = async (keys: string[]) => {
    if (!keys.length) return;
    setAction("cancel");
    try {
      const result = await cancelPendingReflections(keys);
      setSelected(new Set());
      toast.success(
        t("已取消 {count} 条反思", {
          count: formatNumber(result.cancelled_count),
        }),
      );
      await load(true);
    } catch (error) {
      toast.error(t("取消反思失败"), {
        description: error instanceof Error ? error.message : t("未知错误"),
      });
    } finally {
      setAction(null);
    }
  };

  const openRegeneration = async (memory: ReflectionMemoryRecord) => {
    if (!memory.source_available || !memory.document_sha256) return;
    setRegenerateTarget(memory);
    setSourceDetail(null);
    setVerifierFeedback("");
    setSourceLoading(true);
    try {
      const detail = await getReflectionSource(memory.source_digest);
      setSourceDetail(detail);
      setVerifierFeedback(detail.source.verifier_feedback || "");
    } catch (error) {
      toast.error(t("关联轨迹加载失败"), {
        description: error instanceof Error ? error.message : t("未知错误"),
      });
    } finally {
      setSourceLoading(false);
    }
  };

  const submitRegeneration = async () => {
    if (!regenerateTarget?.document_sha256) return;
    const feedback = verifierFeedback.trim();
    if (!feedback) {
      toast.error(t("请填写 verifier 反馈"));
      return;
    }
    setSubmitting(true);
    try {
      const status = await regenerateReflectionMemory(
        regenerateTarget.source_digest,
        feedback,
        regenerateTarget.document_sha256,
      );
      setRegeneration(status);
      setRegenerateTarget(null);
      setSourceDetail(null);
      setVerifierFeedback("");
      toast.success(t("重新反思已进入后台队列"));
    } catch (error) {
      toast.error(t("重新反思启动失败"), {
        description: error instanceof Error ? error.message : t("未知错误"),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-frame">
      <PageHeader
        title={t("Reflection Memory")}
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw />
            {t("刷新")}
          </Button>
        }
      />

      {regeneration.status !== "idle" ? (
        <div className="mb-4 space-y-4 border bg-muted/20 p-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div className="flex min-w-0 items-start gap-3">
              {regenerating ? (
                <LoaderCircle className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" />
              ) : regeneration.status === "succeeded" ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              ) : (
                <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{t("重新反思")}</span>
                  <Badge
                    variant={
                      regeneration.status === "failed"
                        ? "destructive"
                        : "outline"
                    }
                  >
                    {t(REGENERATION_STATUS_LABELS[regeneration.status])}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t(regeneration.message)}
                </div>
                {regeneration.details?.trajectory_id ? (
                  <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                    {String(regeneration.details.trajectory_id)}
                  </div>
                ) : null}
                {regeneration.error ? (
                  <div className="mt-1 text-xs text-destructive">
                    {regeneration.error}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-mono text-sm font-semibold">
                {formatNumber(
                  Math.max(0, Math.min(100, regeneration.progress)),
                )}
                %
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {t("服务端后台任务")}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {REGENERATION_STEPS.map((step, index) => (
              <div key={step}>
                <div
                  className={cn(
                    "h-1 bg-muted",
                    index <= activeRegenerationStep &&
                      (regeneration.status === "failed"
                        ? "bg-destructive"
                        : "bg-primary"),
                  )}
                />
                <div className="mt-2 hidden text-[9px] text-muted-foreground sm:block">
                  {t(step)}
                </div>
              </div>
            ))}
          </div>
          {regenerating ? (
            <div className="text-[11px] text-muted-foreground">
              {t(
                "任务由服务端继续执行；可以切换页面，返回后会自动恢复当前进度。",
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <Tabs defaultValue="memories">
        <TabsList>
          <TabsTrigger value="memories">
            {t("记忆")} · {formatNumber(memories.length)}
          </TabsTrigger>
          <TabsTrigger value="pending">
            {t("队列")} · {formatNumber(pending.length)}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="memories">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={memoryQuery}
                onChange={(event) => setMemoryQuery(event.target.value)}
                placeholder={t("搜索标题或轨迹 ID")}
                className="pl-9"
              />
            </div>
          </div>
          <Card>
            <CardContent className="p-0">
              {visibleMemories.length ? (
                <Table className="min-w-[1040px] table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-72">{t("记忆")}</TableHead>
                      <TableHead className="w-28">{t("结果")}</TableHead>
                      <TableHead className="w-64">{t("关联轨迹")}</TableHead>
                      <TableHead className="w-36">{t("来源规模")}</TableHead>
                      <TableHead className="w-36">{t("生成时间")}</TableHead>
                      <TableHead className="w-36 text-right">
                        {t("操作")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleMemories.map((memory) => {
                      const runningThis =
                        regenerating &&
                        regeneration.details?.source_digest ===
                          memory.source_digest;
                      return (
                        <TableRow key={memory.source_digest}>
                          <TableCell>
                            <button
                              type="button"
                              className="line-clamp-2 w-full rounded-sm text-left text-sm font-medium leading-5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => setMemoryDetail(memory)}
                            >
                              {memory.title}
                            </button>
                            <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                              {memory.document_path || memory.source_digest}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={outcomeVariant(memory.outcome)}>
                              {t(OUTCOME_LABELS[memory.outcome])}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-start gap-2">
                              <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <div className="min-w-0">
                                <div className="break-all font-mono text-[11px] leading-4">
                                  {memory.trajectory_id}
                                </div>
                                <div className="mt-1 text-[10px] text-muted-foreground">
                                  {memory.source_available
                                    ? t("轨迹快照已保留")
                                    : t("历史轨迹未保留")}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            <div>
                              {formatNumber(
                                memory.trajectory_source?.source_token_count ||
                                  memory.source_token_count,
                              )}{" "}
                              tokens
                            </div>
                            <div className="mt-1">
                              {t("{count} 条事件", {
                                count: formatNumber(
                                  memory.trajectory_source
                                    ?.trajectory_row_count ||
                                    memory.source_event_count,
                                ),
                              })}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {formatTime(memory.created_at)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={
                                !memory.source_available ||
                                !memory.document_sha256 ||
                                regenerating
                              }
                              onClick={() => void openRegeneration(memory)}
                            >
                              {runningThis ? (
                                <LoaderCircle className="animate-spin" />
                              ) : (
                                <RotateCcw />
                              )}
                              {t("重新反思")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  icon={loading ? LoaderCircle : BrainCircuit}
                  title={
                    !available
                      ? t("服务重启后启用")
                      : loading
                        ? t("正在读取反思记忆")
                        : memoryQuery
                          ? t("没有匹配记忆")
                          : t("暂无 Reflection Memory")
                  }
                  description={
                    !available
                      ? t("后端接口尚未进入当前运行进程。")
                      : memoryQuery
                        ? t("清除搜索条件后重试。")
                        : t("轨迹完成反思后会出现在这里。")
                  }
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pending">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={pendingQuery}
                onChange={(event) => setPendingQuery(event.target.value)}
                placeholder={t("搜索响应 ID 或摘要")}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="mr-1 text-xs text-muted-foreground">
                {t("已选 {count}", { count: formatNumber(selected.size) })}
              </span>
              <Button
                size="sm"
                disabled={
                  !selected.size || selectedHasRunning || action !== null
                }
                onClick={() => void startNow([...selected])}
              >
                {action === "start" ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Play />
                )}
                {t("立即反思")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!selected.size || action !== null}
                onClick={() => void cancel([...selected])}
              >
                {action === "cancel" ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <X />
                )}
                {t("取消反思")}
              </Button>
            </div>
          </div>
          <Card>
            <CardContent className="p-0">
              {visiblePending.length ? (
                <Table className="min-w-[1080px] table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-11">
                        <input
                          type="checkbox"
                          aria-label={t("全选待反思轨迹")}
                          checked={allVisibleSelected}
                          ref={(node) => {
                            if (node)
                              node.indeterminate =
                                someVisibleSelected && !allVisibleSelected;
                          }}
                          onChange={toggleAll}
                          className="h-4 w-4 accent-primary"
                        />
                      </TableHead>
                      <TableHead className="w-44">{t("响应 ID")}</TableHead>
                      <TableHead className="w-64">{t("摘要")}</TableHead>
                      <TableHead className="w-24">{t("状态")}</TableHead>
                      <TableHead className="w-32">{t("上次活动")}</TableHead>
                      <TableHead className="w-28">{t("开始整理")}</TableHead>
                      <TableHead className="w-28">{t("规模")}</TableHead>
                      <TableHead className="w-40 text-right">
                        {t("操作")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visiblePending.map((item) => (
                      <TableRow key={item.conversation_key}>
                        <TableCell>
                          <input
                            type="checkbox"
                            aria-label={t("选择 {id}", {
                              id: item.trajectory_id,
                            })}
                            checked={selected.has(item.conversation_key)}
                            onChange={() => toggleOne(item.conversation_key)}
                            className="h-4 w-4 accent-primary"
                          />
                        </TableCell>
                        <TableCell>
                          <span className="block select-all break-all font-mono text-[11px] leading-4 text-muted-foreground">
                            {item.trajectory_id}
                          </span>
                        </TableCell>
                        <TableCell>
                          <button
                            type="button"
                            aria-expanded={
                              summaryConversationKey === item.conversation_key
                            }
                            aria-label={t("查看任务全文")}
                            className="line-clamp-2 w-full max-w-64 rounded-sm text-left text-sm font-medium leading-5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() =>
                              setSummaryConversationKey(item.conversation_key)
                            }
                          >
                            {item.original_task || t("未命名任务")}
                          </button>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              item.status === "running" ? "default" : "outline"
                            }
                          >
                            {item.status === "running"
                              ? t("整理中")
                              : t("等待")}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {formatTime(item.last_activity_at)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {remainingLabel(item, now)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <div>
                            {formatNumber(item.source_token_count)} tokens
                          </div>
                          <div className="mt-1">
                            {t("{count} 工具事件", {
                              count: formatNumber(item.event_count),
                            })}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={
                                item.status === "running" || action !== null
                              }
                              onClick={() =>
                                void startNow([item.conversation_key])
                              }
                            >
                              <Play />
                              {t("立即")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={action !== null}
                              onClick={() =>
                                void cancel([item.conversation_key])
                              }
                            >
                              <X />
                              {t("取消")}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  icon={loading ? LoaderCircle : Clock3}
                  title={
                    loading
                      ? t("正在读取反思队列")
                      : pendingQuery
                        ? t("没有匹配轨迹")
                        : t("暂无待反思轨迹")
                  }
                  description={
                    pendingQuery
                      ? t("清除搜索条件后重试。")
                      : t("新轨迹满足反思条件后会出现在这里。")
                  }
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={Boolean(memoryDetail)}
        onOpenChange={(open) => {
          if (!open) setMemoryDetail(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{memoryDetail?.title}</DialogTitle>
            <DialogDescription className="break-all font-mono text-xs leading-5">
              {memoryDetail?.trajectory_id}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-2">
            {memoryDetail
              ? memoryTextSections(memoryDetail).map(([label, content]) => (
                  <section key={label}>
                    <h3 className="mb-1 text-xs font-semibold text-muted-foreground">
                      {t(label)}
                    </h3>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6">
                      {content}
                    </p>
                  </section>
                ))
              : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMemoryDetail(null)}>
              {t("关闭")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(regenerateTarget)}
        onOpenChange={(open) => {
          if (!open && !submitting) {
            setRegenerateTarget(null);
            setSourceDetail(null);
            setVerifierFeedback("");
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("重新反思")}</DialogTitle>
            <DialogDescription>
              {t(
                "使用已关联的完整轨迹与 verifier 反馈重新生成并替换当前记忆。",
              )}
            </DialogDescription>
          </DialogHeader>
          {sourceLoading ? (
            <div className="flex min-h-40 items-center justify-center text-muted-foreground">
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              {t("正在读取关联轨迹")}
            </div>
          ) : sourceDetail ? (
            <div className="space-y-4">
              <div className="border bg-muted/20 p-3">
                <div className="break-all font-mono text-[11px] leading-5">
                  {sourceDetail.source.trajectory_id}
                </div>
                <div className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-5">
                  {sourceDetail.source.original_task || t("未命名任务")}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span>
                    {formatNumber(sourceDetail.source.source_token_count)}{" "}
                    tokens
                  </span>
                  <span>
                    {t("{count} 条事件", {
                      count: formatNumber(
                        sourceDetail.source.trajectory_row_count,
                      ),
                    })}
                  </span>
                  <span>
                    {t("{count} 个 capsule", {
                      count: formatNumber(sourceDetail.source.capsule_count),
                    })}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reflection-verifier-feedback">
                  {t("Verifier 反馈")}
                </Label>
                <Textarea
                  id="reflection-verifier-feedback"
                  value={verifierFeedback}
                  onChange={(event) => setVerifierFeedback(event.target.value)}
                  placeholder={t(
                    "粘贴 verifier 的通过项、失败项、错误原文与验收边界。",
                  )}
                  className="min-h-44 resize-y font-mono text-xs leading-5"
                  maxLength={131072}
                />
                <div className="text-[11px] text-muted-foreground">
                  {t("失败时保留原记忆；成功后原子替换并热编译 Tensor Bank。")}
                </div>
              </div>
            </div>
          ) : (
            <div className="min-h-32 border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {t("关联轨迹不可用，无法重新反思。")}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={submitting}
              onClick={() => setRegenerateTarget(null)}
            >
              {t("取消")}
            </Button>
            <Button
              disabled={
                !sourceDetail ||
                !verifierFeedback.trim() ||
                submitting ||
                regenerating
              }
              onClick={() => void submitRegeneration()}
            >
              {submitting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <RotateCcw />
              )}
              {t("开始重新反思")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(summaryItem)}
        onOpenChange={(open) => {
          if (!open) setSummaryConversationKey(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("任务全文")}</DialogTitle>
            <DialogDescription className="break-all font-mono text-xs leading-5">
              {summaryItem?.trajectory_id}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto overflow-x-hidden border bg-muted/30 p-4">
            <p className="whitespace-pre-wrap break-words text-sm leading-6">
              {summaryItem?.original_task || t("未命名任务")}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSummaryConversationKey(null)}
            >
              {t("关闭")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
