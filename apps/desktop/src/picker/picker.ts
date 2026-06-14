interface Item {
  id: string;
  name: string;
  kind: string;
  dataUrl: string;
}

declare global {
  interface Window {
    picker: {
      onItems(cb: (items: Item[]) => void): void;
      choose(id: string | null): void;
    };
  }
}

const grid = document.getElementById('grid')!;
window.picker.onItems(items => {
  grid.innerHTML = '';
  for (const it of items) {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `<img src="${it.dataUrl}" /><span>${it.name}</span>`;
    el.onclick = () => window.picker.choose(it.id);
    grid.appendChild(el);
  }
});
document.getElementById('cancel')!.onclick = () => window.picker.choose(null);

export {};
