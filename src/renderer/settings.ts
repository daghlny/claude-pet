export {};
const cp = (window as unknown as { claudePet: any }).claudePet;

const petsDiv = document.getElementById("pets") as HTMLDivElement;
const scaleInput = document.getElementById("scale") as HTMLInputElement;
const clickThroughInput = document.getElementById("clickThrough") as HTMLInputElement;
const importBtn = document.getElementById("import") as HTMLButtonElement;
const importStatus = document.getElementById("importStatus") as HTMLSpanElement;

async function refresh() {
  const [pets, settings] = await Promise.all([
    cp.listPets(),
    cp.getSettings(),
  ]);
  scaleInput.value = String(settings.scale);
  clickThroughInput.checked = !!settings.clickThrough;
  petsDiv.innerHTML = "";
  for (const m of pets) {
    const el = document.createElement("div");
    el.className = "pet" + (m.slug === settings.petSlug ? " active" : "");
    el.innerHTML = `<h3>${m.name ?? m.slug}</h3><p>${m.slug}</p>`;
    el.onclick = async () => {
      await cp.switchPet(m.slug);
      refresh();
    };
    petsDiv.appendChild(el);
  }
}

scaleInput.oninput = async () => {
  await cp.saveSettings({ scale: parseFloat(scaleInput.value) });
};

clickThroughInput.onchange = async () => {
  await cp.saveSettings({ clickThrough: clickThroughInput.checked });
};

// Stay in sync when ghost mode is toggled elsewhere (tray menu, CLI/external
// settings edit) while this window is open.
cp.onGhost((on: boolean) => {
  clickThroughInput.checked = on;
});

importBtn.onclick = async () => {
  importStatus.textContent = "…";
  const r = await cp.importPet();
  if (!r) { importStatus.textContent = ""; return; }
  importStatus.textContent = r.ok ? `Imported → ${r.dest}` : `Error: ${r.error}`;
  refresh();
};

refresh();
