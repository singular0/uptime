/* global Chart, moment */

// Draws (or redraws) a line chart of a DateInterval's stats in `container` with Chart.js.
// Clicking a point zooms the interval into that point's period.
//
// options:
//   points:  [{ x: timestamp in ms, y: number }]
//   color:   CSS variable holding the line color as #rrggbb, e.g. '--chart-availability'
//   unit:    suffix for values in the tooltip, e.g. '%' or ' ms'
//   percent: true to scale the y axis between the lowest value (with some margin) and 100
//   fill:    true to fill the area under the line with a gradient of the color
function drawStatGraph(container, interval, options) {
  let canvas = container.querySelector('canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    container.appendChild(canvas);
  }
  Chart.getChart(canvas)?.destroy();

  const points = options.points;
  const color = () => cssVariable(options.color);
  // The CSS lines the plot area up with the period buttons. For that, the y axis has the width
  // the CSS expects, and the plot area has no padding (layout.autoPadding) on its right.
  const yAxisWidth = parseFloat(getComputedStyle(container).getPropertyValue('--graph-y-axis-width'));
  // grid and tick colors are functions, read again when the color mode changes
  const grid = {
    color: () => cssVariable('--bs-border-color-translucent'),
  };
  const yScale = {
    beginAtZero: true,
    afterFit(axis) {
      axis.width = yAxisWidth;
    },
    grid: grid,
    border: { display: false },
    ticks: {
      maxTicksLimit: 5,
      color: () => cssVariable('--bs-secondary-color'),
    },
  };
  if (options.percent && points.length) {
    const min = Math.min(...points.map(point => point.y));
    // a lower bound below the lowest value that falls on a tick: steps of 1 above 90%, of 10
    // above 60%, of 20 otherwise (at most 5 ticks)
    yScale.min = min >= 90 ? Math.floor(min - 1) : min >= 60 ? Math.floor(min / 10) * 10 : Math.floor(min / 20) * 20;
    yScale.max = 100;
  }
  const halfPeriod = interval.getSubTypeDuration() / 2;
  const canZoom = () => !interval.isMaxZoom();

  return new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [{
        data: points,
        borderColor: color,
        borderWidth: 2,
        backgroundColor: options.fill ? gradientFill(color) : color,
        fill: options.fill ? 'start' : false,
        pointBackgroundColor: () => cssVariable('--bs-body-bg'),
        pointBorderColor: color,
        pointRadius: 3,
        pointHoverRadius: 5,
        tension: 0,
      }],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      layout: { autoPadding: false },
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: {
          type: 'linear',
          min: interval.begin.valueOf() - halfPeriod,
          max: interval.end.valueOf() - halfPeriod,
          ticks: { display: false },
          grid: { display: false },
          border: { color: grid.color },
        },
        y: yScale,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: items => moment(items[0].parsed.x).format('LLLL'),
            label: item => item.parsed.y + options.unit,
          },
        },
      },
      onHover(event, elements) {
        event.native.target.style.cursor = elements.length && canZoom() ? 'pointer' : 'default';
      },
      onClick(event, elements) {
        if (!elements.length || !canZoom()) return;
        interval.update(interval.subType(), points[elements[0].index].x);
      },
    },
  });
}

// The value of a CSS variable for the current color mode
function cssVariable(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// A #rrggbb color with an opacity, as rgba()
function withAlpha(color, alpha) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!match) return color;
  return `rgba(${parseInt(match[1], 16)}, ${parseInt(match[2], 16)}, ${parseInt(match[3], 16)}, ${alpha})`;
}

function gradientFill(color) {
  return function(context) {
    const { ctx, chartArea } = context.chart;
    if (!chartArea) return; // not laid out yet
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, withAlpha(color(), .4));
    gradient.addColorStop(1, withAlpha(color(), 0));
    return gradient;
  };
}

// graphs use the font of the page
Chart.defaults.font.family = cssVariable('--bs-body-font-family');

// redraw the graphs in the colors of the new color mode
document.addEventListener('themechange', function() {
  Object.values(Chart.instances).forEach(chart => chart.update('none'));
});
