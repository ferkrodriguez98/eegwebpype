// Shared types between web and api.
// In F2 these will be auto-generated from Pydantic, for F1 we hand-write them.

export type Health = {
  ok: boolean;
  service: string;
  version: string;
};

export type SessionId = `${string}_${"D1" | "D2"}`;

export type SessionStatus = "raw" | "in_progress" | "done" | "exported" | "needs_review";

export type SessionRef = {
  id: SessionId;
  subject: string;
  session: "D1" | "D2";
  status: SessionStatus;
  last_opened: string | null;
  source_file: string;
};

export type Workspace = {
  version: 1;
  data_root: string;
  sessions: SessionRef[];
};

export type SessionMetadata = {
  sfreq_original: number;
  sfreq_current: number;
  n_channels_original: number;
  n_channels_current: number;
  duration_seconds: number;
  channel_names: string[];
};

type EventBase = { id: string; ts: string };

export type BadReason = "auto_power" | "auto_shape" | "auto_neighbors" | "manual";

export type LoadEvent = EventBase & { op: "load"; params: { source_file: string } };
export type DropChannelsEvent = EventBase & { op: "drop_channels"; params: { channels: string[] } };
export type SetMontageEvent = EventBase & { op: "set_montage"; params: { montage: string } };
export type ResampleEvent = EventBase & { op: "resample"; params: { sfreq: number } };
export type FilterEvent = EventBase & {
  op: "filter";
  params: { l_freq?: number; h_freq?: number; l_trans?: number; h_trans?: number };
};
export type MarkBadEvent = EventBase & {
  op: "mark_bad";
  params: { channels: string[]; reason: BadReason };
};
export type UnmarkBadEvent = EventBase & {
  op: "unmark_bad";
  params: { channels: string[] };
};

export type InterpolateBadsEvent = EventBase & {
  op: "interpolate_bads";
  params: Record<string, never>;
};
export type SetReferenceEvent = EventBase & {
  op: "set_reference";
  params: { type: "average" | "REST" | "rest" };
};
export type EpochEvent = EventBase & {
  op: "epoch";
  params: { length_seconds: number; overlap: number; detrend: number | null };
};
export type RejectEpochsEvent = EventBase & {
  op: "reject_epochs";
  params: { indices: number[]; reason: "auto_ptp" | "manual" };
};
export type ExportEvent = EventBase & {
  op: "export";
  params: { kind: "epochs" | "raw"; path: string };
};

export type Event =
  | LoadEvent
  | DropChannelsEvent
  | SetMontageEvent
  | ResampleEvent
  | FilterEvent
  | MarkBadEvent
  | UnmarkBadEvent
  | InterpolateBadsEvent
  | SetReferenceEvent
  | EpochEvent
  | RejectEpochsEvent
  | ExportEvent;

export type EventInput = { op: string; params: Record<string, unknown> };

export type DetectorReason = "auto_power" | "auto_shape" | "auto_neighbors";

export type ChannelDetection = {
  channel: string;
  reasons: DetectorReason[];
  pot_z: number;
  shape_dev_db: number;
  neighbor_corr: number;
};

export type DetectBadResult = {
  detections: ChannelDetection[];
  threshold_pot_z: number;
  threshold_shape_db: number;
  threshold_neighbor_corr: number;
};

export type TopomapMetric = "shape_dev" | "power_50hz" | "power_alpha" | "power_gamma";

export type TopomapPoint = { channel: string; x: number; y: number; value: number };

export type TopomapResponse = { metric: TopomapMetric; points: TopomapPoint[] };

export type ICAComponent = {
  index: number;
  label: string;
  prob: number;
  topo: number[];
  series: number[];
};

export type ICAFitResult = {
  n_components: number;
  method: string;
  components: ICAComponent[];
};

export type EpochsMatrix = {
  n_epochs: number;
  n_channels: number;
  channel_names: string[];
  ptp_matrix: number[][];
  ptp_max_per_epoch: number[];
  rejected_indices: number[];
  threshold_uv: number;
};

export type ExportResult = {
  fif_path: string;
  log_path: string;
  n_epochs: number;
  n_channels: number;
};

export type SessionState = {
  id: SessionId;
  subject: string;
  session: "D1" | "D2";
  source_file: string;
  created_at: string;
  updated_at: string;
  events: Event[];
  snapshots: Record<string, string>[];
  metadata: SessionMetadata;
};
