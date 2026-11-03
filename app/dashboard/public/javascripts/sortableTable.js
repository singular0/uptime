// Makes a table sortable by clicking its column headers.
// Rows are compared on the `data-sort` attribute of their cells: numerically when both
// values are numbers, otherwise as case-insensitive text.
// Call sort() after replacing the rows to apply the current order to them.
class SortableTable {
  constructor(table, { column = 0, direction = 'asc' } = {}) {
    this.table = table;
    this.column = column;
    this.direction = direction;
    this.headers = Array.from(table.tHead.rows[0].cells);
    this.headers.forEach((header, index) => {
      header.classList.add('sortable');
      header.addEventListener('click', () => this.sortBy(index));
    });
    this.sort();
  }

  sortBy(column) {
    this.direction = column === this.column && this.direction === 'asc' ? 'desc' : 'asc';
    this.column = column;
    this.sort();
  }

  sort() {
    const factor = this.direction === 'asc' ? 1 : -1;
    const value = row => row.cells[this.column]?.dataset.sort ?? '';
    const tbody = this.table.tBodies[0];
    const rows = Array.from(tbody.rows);
    rows.sort((a, b) => factor * SortableTable.compare(value(a), value(b)));
    tbody.append(...rows);
    this.headers.forEach((header, index) => {
      if (index === this.column) {
        header.setAttribute('aria-sort', this.direction === 'asc' ? 'ascending' : 'descending');
      } else {
        header.removeAttribute('aria-sort');
      }
    });
  }

  static compare(a, b) {
    if (a !== '' && b !== '' && !isNaN(a) && !isNaN(b)) return a - b;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  }
}
