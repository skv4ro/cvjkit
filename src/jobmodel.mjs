// cvjkit — semantic model extractor. Walks the decoded Contents object graph
// (from contents.tryDecode) and pulls out a clean, human-readable job model:
// job unit, rooms/walls, and every cabinet with its size, key dimensions and
// hardware/part counts. Works on a PARTIAL decode too — it reads every object
// decoded before the frontier straight from the context's index map.
import { openContainer, getStream } from '../app/cvj.js';
import './codecs.mjs';
import './foundations.mjs';
import { tryDecode } from './contents.mjs';

const MM = (inch) => Math.round(inch * 25.4 * 100) / 100;   // inches → mm

// Pull a named parameter's numeric value from a decoded CVParameter list.
function paramValue(params, name) {
  for (const p of params || []) {
    if (p && p.__class === 'CVParameter' && p.name === name) {
      const v = p.value;
      if (v && typeof v === 'object' && 'value' in v) return v.value;
      return v;
    }
  }
  return undefined;
}

function cabinetInfo(cab) {
  const size = cab.size ? { w: MM(cab.size.x), h: MM(cab.size.y), d: MM(cab.size.z) } : null;
  // count hardware/parts among this cabinet's decoded descendants is done globally;
  // here we surface the cabinet's own identity + size + a few driving params.
  const dims = {};
  for (const k of ['_BW', '_BH', '_BD', 'DX', 'DY', 'DZ', 'W', 'H', 'D']) {
    const v = paramValue(cab.params, k);
    if (v !== undefined) dims[k] = v;
  }
  return { name: cab.name || '', label: cab.label || '', sizeMm: size, params: dims };
}

export function extractModel(contents) {
  const res = tryDecode(contents);
  const map = res.ctx ? res.ctx.map : [];
  const objs = map.filter((e) => e && e.obj).map((e) => e.obj);

  const byClass = {};
  for (const o of objs) byClass[o.__class] = (byClass[o.__class] || 0) + 1;

  const job = objs.find((o) => o.__class === 'CVJob');
  const cabinets = objs.filter((o) => o.__class === 'CVCabinet').map(cabinetInfo);

  return {
    decoded: res.ok ? 'full' : 'partial',
    consumed: res.ok ? res.consumed : res.at,
    total: contents.length,
    frontier: res.ok ? null : res.className,
    unit: job ? { symbol: job.unitSymbol, name: job.unitName } : null,
    counts: {
      objects: objs.length,
      cabinets: cabinets.length,
      walls: byClass.CVWall || 0,
      rooms: byClass.CVFloorLevel || 0,
      parts: byClass.CVAssembly || 0,
      hardware: (byClass.CVHardware || 0) + (byClass.CVLegLeveler || 0) +
                (byClass.CVHinge || 0) + (byClass.CVSmartFace || 0),
      doors: byClass.CVDoor || 0,
      parameters: byClass.CVParameter || 0,
    },
    classHistogram: byClass,
    cabinets,
  };
}

export function extractModelFromCvj(data) {
  const contents = getStream(openContainer(data), 'Contents');
  if (!contents) throw new Error('no Contents stream');
  return extractModel(contents);
}
