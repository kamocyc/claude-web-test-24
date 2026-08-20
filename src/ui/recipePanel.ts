import {
  CATEGORY_LABELS,
  type Recipe,
  type RecipeCategory,
  type Station,
  canCraft,
  craft,
  craftAll,
  craftableCount,
  recipesFor,
} from '../game/crafting';
import type { Inventory } from '../game/inventory';
import { itemDef, itemLabel } from '../game/items';
import type { Atlas } from '../render/textures';
import { el } from './dom';

const CATEGORY_ORDER: RecipeCategory[] = ['basics', 'tools', 'armor', 'water', 'blocks', 'food'];

interface Row {
  recipe: Recipe;
  node: HTMLButtonElement;
  costs: { ingredient: { id: string; count: number }; node: HTMLElement }[];
  countLabel: HTMLElement;
}

/** The crafting screen: a searchable list of everything the station can make. Clicking
 *  a row pulls the materials straight out of the inventory, so nothing has to be laid
 *  out on a grid. */
export class RecipePanel {
  readonly root = el('div', 'recipe-panel');
  private readonly list = el('div', 'recipe-list');
  private readonly search = el('input', 'recipe-search') as HTMLInputElement;
  private readonly onlyCraftable = el('input', 'recipe-toggle') as HTMLInputElement;
  private readonly empty = el('div', 'recipe-empty', '該当するレシピがありません。');
  private readonly rows: Row[] = [];
  private readonly headings = new Map<RecipeCategory, HTMLElement>();

  constructor(
    private readonly inventory: Inventory,
    station: Station,
    private readonly atlas: Atlas,
    private readonly onCrafted: (recipe: Recipe, made: number) => void,
  ) {
    this.search.type = 'search';
    this.search.placeholder = 'レシピを検索';
    this.search.addEventListener('input', () => this.applyFilter());
    this.onlyCraftable.type = 'checkbox';
    this.onlyCraftable.addEventListener('change', () => this.applyFilter());

    const toggleLabel = el('label', 'recipe-toggle-label');
    toggleLabel.append(this.onlyCraftable, el('span', '', '作れるものだけ'));
    const bar = el('div', 'recipe-bar');
    bar.append(this.search, toggleLabel);

    const available = recipesFor(station);
    for (const category of CATEGORY_ORDER) {
      const inCategory = available.filter((r) => r.category === category);
      if (inCategory.length === 0) continue;
      const heading = el('div', 'recipe-heading', CATEGORY_LABELS[category]);
      this.list.appendChild(heading);
      this.headings.set(category, heading);
      for (const recipe of inCategory) this.list.appendChild(this.buildRow(recipe));
    }
    this.list.appendChild(this.empty);
    this.root.append(bar, this.list);
    this.applyFilter();
  }

  private buildRow(recipe: Recipe): HTMLElement {
    const node = el('button', 'recipe-row') as HTMLButtonElement;
    node.type = 'button';

    const icon = el('div', 'slot small');
    const img = el('img', 'slot-icon') as HTMLImageElement;
    img.src = this.atlas.icon(itemDef(recipe.result.id)?.tex ?? 'stone');
    img.alt = recipe.result.id;
    icon.appendChild(img);
    if (recipe.result.count > 1) icon.appendChild(el('span', 'slot-count', String(recipe.result.count)));

    const text = el('div', 'recipe-text');
    text.appendChild(el('div', 'recipe-name', itemLabel(recipe.result.id)));
    const cost = el('div', 'recipe-cost');
    const costs: Row['costs'] = [];
    for (const ingredient of recipe.ingredients) {
      const span = el('span', 'recipe-ingredient');
      cost.appendChild(span);
      costs.push({ ingredient, node: span });
    }
    text.appendChild(cost);

    const countLabel = el('div', 'recipe-stock');
    node.append(icon, text, countLabel);
    node.addEventListener('click', (event) => this.handleClick(recipe, event.shiftKey));

    this.rows.push({ recipe, node, costs, countLabel });
    return node;
  }

  private handleClick(recipe: Recipe, all: boolean): void {
    const made = all ? craftAll(this.inventory, recipe) : craft(this.inventory, recipe) ? 1 : 0;
    if (made > 0) this.onCrafted(recipe, made);
    this.refresh();
  }

  /** Rebuilds the have/need numbers. Cheap enough to run every frame because it only
   *  writes text that actually changed. */
  refresh(): void {
    for (const row of this.rows) {
      const ready = canCraft(this.inventory, row.recipe);
      row.node.classList.toggle('locked', !ready);
      row.node.disabled = !ready;
      for (const cost of row.costs) {
        const have = this.inventory.count(cost.ingredient.id);
        const text = `${itemLabel(cost.ingredient.id)} ${Math.min(have, cost.ingredient.count)}/${cost.ingredient.count}`;
        if (cost.node.textContent !== text) cost.node.textContent = text;
        cost.node.classList.toggle('missing', have < cost.ingredient.count);
      }
      const times = craftableCount(this.inventory, row.recipe);
      const stock = times > 1 ? `最大 ${times}` : '';
      if (row.countLabel.textContent !== stock) row.countLabel.textContent = stock;
      row.node.title = ready
        ? 'クリックで1個、Shift+クリックでまとめて作成'
        : '材料が足りません';
    }
    if (this.onlyCraftable.checked) this.applyFilter();
  }

  private applyFilter(): void {
    const query = this.search.value.trim().toLowerCase();
    const onlyReady = this.onlyCraftable.checked;
    const shownPerCategory = new Map<RecipeCategory, number>();
    let shown = 0;
    for (const row of this.rows) {
      const label = itemLabel(row.recipe.result.id).toLowerCase();
      const matches =
        (query === '' || label.includes(query) || row.recipe.result.id.includes(query)) &&
        (!onlyReady || canCraft(this.inventory, row.recipe));
      row.node.style.display = matches ? '' : 'none';
      if (matches) {
        shown++;
        shownPerCategory.set(row.recipe.category, (shownPerCategory.get(row.recipe.category) ?? 0) + 1);
      }
    }
    for (const [category, heading] of this.headings) {
      heading.style.display = (shownPerCategory.get(category) ?? 0) > 0 ? '' : 'none';
    }
    this.empty.style.display = shown === 0 ? '' : 'none';
  }
}
