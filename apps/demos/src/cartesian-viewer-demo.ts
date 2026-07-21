// Zoomable Scatterplot Demo - demonstrates CartesianViewer with axis-aware pan/zoom
import { Diagram, css } from '../../../packages/bireactive/src/lib/diagram';
import { CartesianViewer, type CartesianDomain } from '@fiddleviz/bireactive';
import { effect } from 'bireactive';
import type { Mount } from 'bireactive';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Generate random scatterplot data
function generateScatterData(n: number): Array<{ x: number; y: number; r: number }> {
  const data: Array<{ x: number; y: number; r: number }> = [];
  for (let i = 0; i < n; i++) {
    data.push({
      x: Math.random() * 100,
      y: Math.random() * 100,
      r: 2 + Math.random() * 5,
    });
  }
  return data;
}

export class MdCartesianViewerDemo extends Diagram {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      margin: 0 auto;
    }
    svg {
      flex: 1 1 0;
      min-height: 0;
    }
  `;

  private viewer?: CartesianViewer;
  private data = generateScatterData(200);
  private disposeEffect?: () => void;
  private resizeObserver?: ResizeObserver;

  protected scene(s: Mount): void {
    const W = 800;
    const H = 600;

    // Set fixed viewBox
    this.view(W, H);

    // Initialize CartesianViewer with domain
    const domain: CartesianDomain = {
      xMin: 0,
      xMax: 100,
      yMin: 0,
      yMax: 100,
    };

    this.viewer = new CartesianViewer(this.svg, domain, W, H, {
      enablePan: true,
      enableZoom: true,
      showGrid: true,
      xLabel: 'X Axis',
      yLabel: 'Y Axis',
      gridColor: '#2a2d34',
      axisColor: '#cdd5e0',
    });

    // Re-render scatter points whenever the viewer scales change
    this.disposeEffect = effect(() => this.renderScatter());

    // Ensure initial render of scatter points after scales are fully set up
    setTimeout(() => this.renderScatter(), 0);

    // Add controls
    this.addControls();

    // Fit the chart into the available space after the chrome layer is laid out
    requestAnimationFrame(() => this.updateSize());
    this.resizeObserver = new ResizeObserver(() => this.updateSize());
    this.resizeObserver.observe(this);
    this.resizeObserver.observe(this.chromeLayer);
  }

  private renderScatter(): void {
    const dataGroup = this.viewer?.getDataGroup();
    if (!dataGroup) return;

    // Clear existing
    dataGroup.innerHTML = '';

    // Get current scales
    const xScale = this.viewer!.getXScale();
    const yScale = this.viewer!.getYScale();

    // Render points
    for (const point of this.data) {
      const cx = xScale(point.x);
      const cy = yScale(point.y);

      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(cx));
      circle.setAttribute('cy', String(cy));
      circle.setAttribute('r', String(point.r));
      circle.setAttribute('fill', '#4dabf7');
      circle.setAttribute('opacity', '0.6');
      circle.setAttribute('stroke', '#2d7db8');
      circle.setAttribute('stroke-width', '1');

      dataGroup.appendChild(circle);
    }
  }

  private updateSize(): void {
    if (!this.viewer || this.clientWidth === 0 || this.clientHeight === 0) return;
    const chromeHeight = this.chromeLayer?.offsetHeight ?? 0;
    const availableHeight = Math.max(120, this.clientHeight - chromeHeight);
    this.viewer.setSize(this.clientWidth, availableHeight);
  }

  private addControls(): void {
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;';

    const addButton = (label: string, action: () => void): void => {
      const button = document.createElement('button');
      button.textContent = label;
      button.style.cssText = 'padding:6px 12px;background:#2a2d34;border:1px solid #3a3d44;color:#cdd5e0;border-radius:4px;cursor:pointer;font-size:13px;';
      button.addEventListener('click', action);
      button.addEventListener('mouseenter', () => { button.style.background = '#3a3d44'; });
      button.addEventListener('mouseleave', () => { button.style.background = '#2a2d34'; });
      controls.appendChild(button);
    };

    addButton('Reset', () => { this.viewer?.reset(); });
    addButton('Zoom In', () => { this.viewer?.zoomBy(1.3); });
    addButton('Zoom Out', () => { this.viewer?.zoomBy(1 / 1.3); });
    addButton('Pan Left', () => { this.viewer?.pan(-5, 0); });
    addButton('Pan Right', () => { this.viewer?.pan(5, 0); });
    addButton('Pan Up', () => { this.viewer?.pan(0, -5); });
    addButton('Pan Down', () => { this.viewer?.pan(0, 5); });
    addButton('Set ViewBox', () => { this.viewer?.setViewBox({ xMin: 20, xMax: 40, yMin: 20, yMax: 40 }); });

    const smoothBtn = document.createElement('button');
    const updateSmoothLabel = () => { smoothBtn.textContent = this.viewer?.smooth ? 'Smooth: On' : 'Smooth: Off'; };
    smoothBtn.style.cssText = 'padding:6px 12px;background:#2a2d34;border:1px solid #3a3d44;color:#cdd5e0;border-radius:4px;cursor:pointer;font-size:13px;';
    smoothBtn.addEventListener('click', () => {
      if (this.viewer) this.viewer.smooth = !this.viewer.smooth;
      updateSmoothLabel();
    });
    smoothBtn.addEventListener('mouseenter', () => { smoothBtn.style.background = '#3a3d44'; });
    smoothBtn.addEventListener('mouseleave', () => { smoothBtn.style.background = '#2a2d34'; });
    updateSmoothLabel();
    controls.appendChild(smoothBtn);

    this.chromeLayer.appendChild(controls);

    // Add instructions
    const info = document.createElement('div');
    info.style.cssText = 'margin-top:12px;padding:12px;background:#1a1d24;border:1px solid #2a2d34;border-radius:6px;font-size:13px;line-height:1.6;';
    info.innerHTML = `
      <strong>Cartesian Viewer:</strong> Drag to pan • Scroll wheel to zoom • Notice axes rescale
      <br>
      <em>Programmatic pan/zoom/setViewBox now animate smoothly. Toggle "Smooth" off to see reduced-motion/immediate behavior.</em>
    `;
    this.chromeLayer.appendChild(info);
  }

  disconnectedCallback(): void {
    this.disposeEffect?.();
    this.resizeObserver?.disconnect();
    this.viewer?.dispose();
    super.disconnectedCallback();
  }
}
