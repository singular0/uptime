/* global Chart, moment */

// Draws (or redraws) a line chart of a DateInterval's stats in `container` with Chart.js.
// Clicking a point zooms the interval into that point's period.
//
// options:
//   points:  [{ x: timestamp in ms, y: number }]
//   color:   line color
//   unit:    suffix for values in the tooltip, e.g. '%' or 'ms'
//   percent: true to scale the y axis between the lowest value (with some margin) and 100
//   fill:    true to fill the area under the line with a gradient of `color`
function drawStatGraph(container, interval, options) {
  let canvas = container.querySelector('canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    container.appendChild(canvas);
  }
  Chart.getChart(canvas)?.destroy();

  const points = options.points;
  // The CSS lines the plot area up with the period buttons. For that, the y axis has the width
  // the CSS expects, and the plot area has no padding (layout.autoPadding) on its right.
  const yAxisWidth = parseFloat(getComputedStyle(container).getPropertyValue('--graph-y-axis-width'));
  const yScale = {
    beginAtZero: true,
    afterFit(axis) {
      axis.width = yAxisWidth;
    },
  };
  if (options.percent && points.length) {
    const min = Math.min(...points.map(point => point.y));
    yScale.min = Math.max(0, Math.floor(min < 10 ? min : min < 90 ? min - 10 : min - 1));
    yScale.max = 100;
  }
  const halfPeriod = interval.getSubTypeDuration() / 2;
  const canZoom = () => !interval.isMaxZoom();

  return new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [{
        data: points,
        borderColor: options.color,
        borderWidth: 3,
        backgroundColor: options.fill ? gradientFill(options.color) : options.color,
        fill: options.fill ? 'start' : false,
        pointBackgroundColor: '#fff',
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

function gradientFill(color) {
  return function(context) {
    const { ctx, chartArea } = context.chart;
    if (!chartArea) return; // not laid out yet
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, color + '66'); // 40% opacity, expects a #rrggbb color
    gradient.addColorStop(1, '#ffffff66');
    return gradient;
  };
}
