<script lang="ts">
  import { dlg, setIds } from "../lib/dialog.svelte";
  import { nav } from "../lib/nav.svelte";
  import { defaultIds } from "../lib/settings.svelte";
  import { pickStructIds } from "../lib/structIdImport";
  import { setTaskIds, tsk } from "../lib/task.svelte";
  import { toast } from "../lib/ui.svelte";
  import { idsFromFile, type DefaultIds } from "../model/defaultIds";
  import type { FileKind } from "../model/taskCodec";

  let { kind }: { kind: FileKind } = $props();
  let importing = $state(false);

  const currentDoc = () => (kind === "dialog" ? dlg.doc : tsk.doc);

  function apply(ids: Partial<DefaultIds>) {
    const current: Partial<DefaultIds> | undefined = currentDoc()?.ids;
    const keys = Object.keys(ids) as (keyof DefaultIds)[];
    if (!current || keys.every((key) => current[key] === ids[key])) return;
    if (kind === "dialog") setIds(ids);
    else setTaskIds(ids);
  }

  function applyDefaults() {
    const preset = defaultIds();
    const ids = kind === "dialog" ? idsFromFile("dialog", preset) : idsFromFile("task", preset);
    if (Object.keys(ids).length === 0) {
      toast("全局设置中没有已填写的默认结构体 ID", "error");
      return;
    }
    apply(ids);
    toast("已使用默认配置覆盖结构体 ID");
  }

  async function applyFromFile() {
    const doc = currentDoc();
    if (importing || !doc) return;
    const subpages = nav.subs;
    importing = true;
    try {
      const source = await pickStructIds(kind);
      if (!source || currentDoc() !== doc || nav.subs !== subpages) return;
      apply(source.ids);
      toast(`已使用 ${source.name} 覆盖结构体 ID`);
    } finally {
      importing = false;
    }
  }
</script>

<div class="actions">
  <button type="button" class="btn" onclick={applyDefaults} disabled={importing}
    data-tip="使用全局设置中已填写的默认结构体 ID，留空的项沿用当前值">使用默认配置覆盖</button>
  <button type="button" class="btn" onclick={applyFromFile} disabled={importing}>使用其他文件覆盖</button>
</div>

<style>
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s2);
  }
</style>
