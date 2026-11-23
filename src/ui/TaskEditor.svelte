<script lang="ts">
  // 任务编辑框：编辑副本，保存时才写回。字段含义见 docs/任务迁移方案.md 3.1
  import { untrack } from "svelte";
  import { MARKER_LABELS, MARKER_RANGE, MARKER_RANGES, type TaskItem } from "../model/task";
  import CollapsibleCard from "./CollapsibleCard.svelte";
  import Dropdown from "./Dropdown.svelte";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import RadioGroup from "./RadioGroup.svelte";

  let {
    task,
    duplicateOf,
    onsave,
    oncancel,
  }: {
    task: TaskItem;
    /** 判断编号是否与别的任务重复 */
    duplicateOf: (id: number) => boolean;
    onsave: (task: TaskItem) => void;
    oncancel: () => void;
  } = $props();

  const initial = untrack(() => task);
  let draft = $state<TaskItem>({ ...initial });

  const INT32_MAX = 2147483647;
  const toInt = (v: unknown, min: number, max: number) => Math.min(Math.max(Math.trunc(Number(v) || 0), min), max);
  const toFloat = (v: unknown) => Math.max(Math.round((Number(v) || 0) * 100) / 100, 0);

  let idDup = $derived(duplicateOf(toInt(draft.id, -INT32_MAX, INT32_MAX)));
  let rangeOptions = MARKER_RANGES.map((r) => ({ value: String(r), label: `${r} m` }));
  // 读到的范围不在可选列表里时（如示例里的 0）也能显示
  let rangeValue = $derived(String(draft.markerRange));
  let rangeList = $derived(
    MARKER_RANGES.includes(draft.markerRange as (typeof MARKER_RANGES)[number])
      ? rangeOptions
      : [{ value: rangeValue, label: `${draft.markerRange} m（不在可选范围内）` }, ...rangeOptions],
  );

  function save() {
    const out = $state.snapshot(draft) as TaskItem;
    out.id = toInt(out.id, -INT32_MAX, INT32_MAX);
    out.point = toInt(out.point, -INT32_MAX - 1, INT32_MAX);
    out.detect = toFloat(out.detect);
    out.auto = Math.round((Number(out.auto) || 0) * 100) / 100;
    onsave(out);
  }

  function onkeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      save();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div {onkeydown}>
  <Modal title="编辑任务 {initial.id}" width={640} onclose={oncancel}>
    <div class="cards">
      <CollapsibleCard title="文本" open enter={false} unclip>
        <div class="grid">
          <div class="field">
            <label class="label" for="te-id">任务编号</label>
            <input id="te-id" class="input" class:invalid={idDup} type="number" step="1" bind:value={draft.id} />
            {#if idDup}<span class="hint warn"><Icon name="warn" size={12} /> 与其他任务的编号重复</span>{/if}
          </div>
          <div class="field">
            <label class="label" for="te-name">名称</label>
            <input id="te-name" class="input" data-autofocus bind:value={draft.name} />
          </div>
          <div class="field wide">
            <label class="label" for="te-hint">提示</label>
            <input id="te-hint" data-tip="没有标点或距离时显示，留空不显示。" class="input" bind:value={draft.hint} />
          </div>
          <div class="field wide">
            <label class="label" for="te-optional">可选任务</label>
            <input id="te-optional" placeholder="显示为「（可选）…」，留空不显示" class="input" bind:value={draft.optional} />
          </div>
          <div class="field wide">
            <label class="label" for="te-enter-event">进入任务事件</label>
            <input id="te-enter-event" placeholder="成为当前任务时派发的事件名，留空不派发" class="input" bind:value={draft.enterEvent} />
          </div>
        </div>
      </CollapsibleCard>

      <CollapsibleCard title="位置" open enter={false} unclip>
        <div class="grid">
          <div class="field wide">
            <span class="label" id="te-marker">小地图标点</span>
            <RadioGroup
              name="te-marker"
              ariaLabelledby="te-marker"
              columns={3}
              options={MARKER_LABELS.map((label, i) => ({ value: String(i), label }))}
              value={String(draft.marker)}
              onchange={(v) => {
                draft.marker = Number(v);
                // 改成范围圈时，原来的半径不在可选范围内（如单点标点的 0）就取默认 8 m
                if (draft.marker === MARKER_RANGE && !MARKER_RANGES.some((r) => r === draft.markerRange)) draft.markerRange = 8;
              }}
            />
          </div>
          <div class="field">
            <label class="label" for="te-point">任务点位</label>
            <input id="te-point" data-tip="标点、距离和自动推进使用的预设点。" class="input" type="number" step="1" bind:value={draft.point} />
          </div>
          {#if draft.marker === MARKER_RANGE}
            <div class="field">
              <label class="label" for="te-range">范围圈半径</label>
              <Dropdown id="te-range" options={rangeList} value={rangeValue} onchange={(v) => (draft.markerRange = Number(v))} />
            </div>
          {:else}
            <div class="field"></div>
          {/if}
          <div class="field">
            <label class="label" for="te-detect">检测范围（米）</label>
            <input id="te-detect" data-tip="进入范围后提示已到达。0 = 不检测。" class="input" type="number" min="0" step="0.5" bind:value={draft.detect} />
          </div>
          <div class="field">
            <label class="label" for="te-auto">自动推进范围（米）</label>
            <input id="te-auto" data-tip="进入范围后自动推进。≤ 0 = 只由玩法推进。" class="input" type="number" step="0.5" bind:value={draft.auto} />
          </div>
        </div>
      </CollapsibleCard>
    </div>

    {#snippet footer()}
      <span class="hint grow">Ctrl + Enter 保存，Esc 取消</span>
      <button class="btn" onclick={oncancel}>取消</button>
      <button class="btn accent" onclick={save}><Icon name="check" />保存</button>
    {/snippet}
  </Modal>
</div>

<style>
  .cards {
    display: flex;
    flex-direction: column;
    gap: var(--s4);
    padding-top: 6px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s3) var(--s4);
  }
  .wide {
    grid-column: 1 / -1;
  }
  .hint {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .warn {
    color: var(--danger);
  }
  .invalid {
    border-color: var(--danger);
  }
  .grow {
    flex: 1;
  }
  @media (max-width: 640px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
