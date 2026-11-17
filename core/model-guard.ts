export interface ModelRef {
  readonly providerID: string;
  readonly id: string;
}

export interface SessionView {
  readonly model?: ModelRef;
  readonly directory: string;
}

export interface PinnedProvider {
  readonly providerID: string;
  readonly directory: string;
}

export interface CatalogModel extends ModelRef {
  readonly enabled: boolean;
}

export type Refusal = { ok: false; reason: string };
export type PinResult = { ok: true; pinned: PinnedProvider } | Refusal;
export type JudgeModelResult = { ok: true; model: ModelRef } | Refusal;

export interface JudgeModelInput {
  readonly pinned: PinnedProvider;
  readonly session: SessionView;
  readonly pluginDirectory: string;
  readonly catalog: readonly CatalogModel[];
  readonly preferences: readonly string[];
}

const refuse = (reason: string): Refusal => ({ ok: false, reason });

const trimmed = (dir: string): string => dir.replace(/\/+$/, "");
const isWithin = (inner: string, outer: string): boolean => inner === outer || inner.startsWith(`${outer}/`);

// One workspace: a session may sit in the plugin's directory or in a repo inside it (or the other way round). Compared
// per path segment, so /repo-other is not inside /repo.
export function sameWorkspace(a: string, b: string): boolean {
  const [x, y] = [trimmed(a), trimmed(b)];
  return isWithin(x, y) || isWithin(y, x);
}

function checkSession(session: SessionView, pluginDirectory: string): { ok: true; model: ModelRef } | Refusal {
  if (!session.model) return refuse("the session has no selected model");
  if (!sameWorkspace(session.directory, pluginDirectory)) {
    return refuse(`the session runs in ${session.directory}, not in the plugin location ${pluginDirectory}`);
  }
  return { ok: true, model: session.model };
}

export function pinProvider(session: SessionView, pluginDirectory: string): PinResult {
  const checked = checkSession(session, pluginDirectory);
  if (!checked.ok) return checked;
  return { ok: true, pinned: { providerID: checked.model.providerID, directory: session.directory } };
}

// Provider IDs are compared exactly, without V2's legacy alias mapping, so data never reaches a provider other than the one the session selected.
export function resolveJudgeModel(input: JudgeModelInput): JudgeModelResult {
  const { pinned, session } = input;
  const checked = checkSession(session, input.pluginDirectory);
  if (!checked.ok) return checked;
  if (checked.model.providerID !== pinned.providerID) {
    return refuse(`the session switched provider from ${pinned.providerID} to ${checked.model.providerID}`);
  }
  if (!sameWorkspace(session.directory, pinned.directory)) {
    return refuse(`the session moved from ${pinned.directory} to ${session.directory}`);
  }

  const candidates = input.catalog.filter((m) => m.enabled && m.providerID === pinned.providerID);
  for (const preference of input.preferences) {
    const preferred = candidates.find((m) => m.id.includes(preference));
    if (preferred) return { ok: true, model: { providerID: preferred.providerID, id: preferred.id } };
  }
  return { ok: true, model: { providerID: checked.model.providerID, id: checked.model.id } };
}
