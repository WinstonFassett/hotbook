export { VizFormVizElement, VizFormHVizElement } from './VizFormElement'

if (typeof customElements !== 'undefined') {
  if (!customElements.get('vizform-viz')) {
    customElements.define('vizform-viz', VizFormVizElement)
  }
  if (!customElements.get('vizform-hviz')) {
    customElements.define('vizform-hviz', VizFormHVizElement)
  }
}
