import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl'

export const FRESNEL_LAYER_ID = 'wp-fresnel-atmosphere'

type GL = WebGLRenderingContext | WebGL2RenderingContext

type GlobeTransform = {
  worldSize: number
  width: number
  height: number
  center: { lat: number }
  fovInRadians: number
}

function compile(gl: GL, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[fresnel]', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function globeRadiusPixels(tr: GlobeTransform) {
  return tr.worldSize / (2.0 * Math.PI) / Math.cos((tr.center.lat * Math.PI) / 180)
}

/**
 * Stable silhouette radius from viewport focal length only — avoids setStyle
 * crushing the rim when cameraToCenterDistance drifts.
 */
function globeSilhouetteRadiusCss(tr: GlobeTransform) {
  const R = globeRadiusPixels(tr)
  const focal = tr.height / 2 / Math.tan(tr.fovInRadians / 2)
  const D = focal + R
  const under = D * D - R * R
  if (under <= 1e-6) return R * 0.99
  return (focal * R) / Math.sqrt(under)
}

/**
 * Soft blue Fresnel rim + limb shading (same rim on Streets and Satellite;
 * Streets uses a stronger shade for roundness on the OSM basemap).
 */
const FRESNEL_FS_BODY = `
  vec2 frag = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
  float d = distance(frag, u_center) / max(u_radius, 1.0);
  float inside = 1.0 - smoothstep(0.985, 1.02, d);

  // Soft limb shading — sphere roundness (stronger on Streets via u_shade).
  float shade = pow(smoothstep(0.15, 1.0, d), 1.4) * inside;
  float shadeA = shade * u_shade * u_strength;

  // Blue Fresnel rim — same subtle look on Streets and Satellite.
  float fresnel = pow(smoothstep(0.78, 1.0, d), 1.6);
  float rim = fresnel * (1.0 - smoothstep(0.995, 1.02, d));
  float outer = exp(-pow((d - 1.0) * 14.0, 2.0));
  outer *= smoothstep(1.08, 1.0, d);
  float rimA = (rim * 0.26 + outer * 0.18) * u_strength * u_rim;

  vec3 rimBlue = mix(vec3(0.14, 0.36, 0.78), vec3(0.42, 0.62, 0.92), clamp(rim, 0.0, 1.0));
  vec3 shadeCol = vec3(0.03, 0.06, 0.12);

  float alpha = max(shadeA, rimA);
  vec3 blue = mix(shadeCol, rimBlue, clamp(rimA / max(alpha, 0.0001), 0.0, 1.0));
`

export function createFresnelAtmosphereLayer(getMap: () => MapLibreMap | null): CustomLayerInterface {
  let program: WebGLProgram | null = null
  let buffer: WebGLBuffer | null = null
  let aPos = 0
  let uCenter: WebGLUniformLocation | null = null
  let uRadius: WebGLUniformLocation | null = null
  let uStrength: WebGLUniformLocation | null = null
  let uShade: WebGLUniformLocation | null = null
  let uRim: WebGLUniformLocation | null = null
  let uResolution: WebGLUniformLocation | null = null

  return {
    id: FRESNEL_LAYER_ID,
    type: 'custom',
    renderingMode: '2d',

    onAdd(_map, gl: GL) {
      const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
      const vs = compile(
        gl,
        gl.VERTEX_SHADER,
        isWebGL2
          ? `#version 300 es
        in vec2 a_pos;
        void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`
          : `
        attribute vec2 a_pos;
        void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`,
      )
      const fs = compile(
        gl,
        gl.FRAGMENT_SHADER,
        isWebGL2
          ? `#version 300 es
        precision highp float;
        uniform vec2 u_center;
        uniform float u_radius;
        uniform float u_strength;
        uniform float u_shade;
        uniform float u_rim;
        uniform vec2 u_resolution;
        out vec4 fragColor;
        void main() {
          ${FRESNEL_FS_BODY}
          fragColor = vec4(blue, alpha);
        }`
          : `
        precision highp float;
        uniform vec2 u_center;
        uniform float u_radius;
        uniform float u_strength;
        uniform float u_shade;
        uniform float u_rim;
        uniform vec2 u_resolution;
        void main() {
          ${FRESNEL_FS_BODY}
          gl_FragColor = vec4(blue, alpha);
        }`,
      )
      if (!vs || !fs) return
      program = gl.createProgram()
      if (!program) return
      gl.attachShader(program, vs)
      gl.attachShader(program, fs)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn('[fresnel]', gl.getProgramInfoLog(program))
        program = null
        return
      }
      aPos = gl.getAttribLocation(program, 'a_pos')
      uCenter = gl.getUniformLocation(program, 'u_center')
      uRadius = gl.getUniformLocation(program, 'u_radius')
      uStrength = gl.getUniformLocation(program, 'u_strength')
      uShade = gl.getUniformLocation(program, 'u_shade')
      uRim = gl.getUniformLocation(program, 'u_rim')
      uResolution = gl.getUniformLocation(program, 'u_resolution')

      buffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    },

    render(gl: GL, _args: CustomRenderMethodInput) {
      const map = getMap()
      if (!map || !program || !buffer) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tr = (map as any).transform as GlobeTransform
      if (!tr?.worldSize || !tr.fovInRadians || !tr.height) return

      const projection = map.getProjection?.()
      if (projection && projection.type !== 'globe') return

      const zoom = map.getZoom()
      const strength = Math.max(0, Math.min(1, 1 - (zoom - 1.8) / 4.5))
      if (strength < 0.02) return

      const pr = map.getPixelRatio()
      const center = map.project(map.getCenter())
      const radiusCss = globeSilhouetteRadiusCss(tr)
      const minDim = Math.min(tr.width, tr.height)
      if (!Number.isFinite(radiusCss) || radiusCss < minDim * 0.05) return

      // OSM stays in the style; visibility is what marks Streets vs Satellite.
      let streets = false
      try {
        streets = Boolean(map.getLayer('osm') && map.getLayoutProperty('osm', 'visibility') !== 'none')
      } catch {
        streets = Boolean(map.getLayer('osm') && !map.getLayer('satellite'))
      }
      // Same soft blue rim both modes; stronger shade on Streets for roundness.
      // Satellite atmosphere ~56% of original (two 25% cuts).
      const satAtmos = 0.75 * 0.75
      const shadeAmt = streets ? 0.32 : 0.08 * satAtmos
      const rimAmt = streets ? 1.0 : satAtmos

      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.enableVertexAttribArray(aPos)
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

      gl.uniform2f(uCenter, center.x * pr, center.y * pr)
      gl.uniform1f(uRadius, radiusCss * pr)
      gl.uniform1f(uStrength, strength)
      gl.uniform1f(uShade, shadeAmt)
      gl.uniform1f(uRim, rimAmt)
      gl.uniform2f(uResolution, tr.width * pr, tr.height * pr)

      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.disable(gl.DEPTH_TEST)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    },

    onRemove(_map, gl: GL) {
      if (buffer) gl.deleteBuffer(buffer)
      if (program) gl.deleteProgram(program)
      buffer = null
      program = null
    },
  }
}
