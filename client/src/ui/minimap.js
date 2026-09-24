// Minimap : plan du circuit vu de dessus, avec la position de chaque participant.

const COULEUR_PISTE = 'rgba(232, 237, 248, 0.30)';
const COULEUR_CONTOUR = 'rgba(52, 224, 255, 0.55)';

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.points = [];
    this.checkpoints = [];
  }

  /**
   * Projette le circuit dans le plan horizontal et le met à l'échelle du canvas.
   * Un circuit à plusieurs niveaux (rampe sur les toits, loopings) se superpose :
   * c'est voulu, la minimap sert à se situer, pas à mesurer l'altitude.
   */
  prepare(circuit) {
    const brut = [];
    const pas = Math.max(1, Math.floor(circuit.nbFrames / 320));
    for (let k = 0; k < circuit.nbFrames; k += pas) {
      brut.push({ x: circuit.frames[k].pos.x, z: circuit.frames[k].pos.z, s: circuit.frames[k].s });
    }

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of brut) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }

    const marge = 12;
    const taille = this.canvas.width;
    const echelle = Math.min(
      (taille - marge * 2) / Math.max(1, maxX - minX),
      (taille - marge * 2) / Math.max(1, maxZ - minZ)
    );
    const decaleX = (taille - (maxX - minX) * echelle) / 2 - minX * echelle;
    const decaleZ = (taille - (maxZ - minZ) * echelle) / 2 - minZ * echelle;

    this.transforme = (x, z) => [x * echelle + decaleX, z * echelle + decaleZ];
    this.points = brut.map((p) => this.transforme(p.x, p.z));
    this.circuit = circuit;
    this.longueur = circuit.longueur;

    this.checkpoints = circuit.checkpoints.map((cp) => {
      const f = circuit.frames[Math.floor(cp.s / circuit.pas) % circuit.nbFrames];
      return { pos: this.transforme(f.pos.x, f.pos.z), arrivee: cp.ligneArrivee };
    });
  }

  dessine(course) {
    const ctx = this.ctx;
    const t = this.canvas.width;
    ctx.clearRect(0, 0, t, t);
    if (this.points.length < 2) return;

    // Tracé du circuit.
    ctx.beginPath();
    ctx.moveTo(this.points[0][0], this.points[0][1]);
    for (let i = 1; i < this.points.length; i++) ctx.lineTo(this.points[i][0], this.points[i][1]);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 7;
    ctx.strokeStyle = COULEUR_PISTE;
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COULEUR_CONTOUR;
    ctx.stroke();

    // Ligne d'arrivée.
    for (const cp of this.checkpoints) {
      if (!cp.arrivee) continue;
      ctx.fillStyle = '#e8edf8';
      ctx.fillRect(cp.pos[0] - 3, cp.pos[1] - 3, 6, 6);
    }

    // Participants : le joueur par-dessus, pour rester visible.
    const ordonnes = [...course.participants].sort(
      (a, b) => (a === course.moi ? 1 : 0) - (b === course.moi ? 1 : 0)
    );
    for (const p of ordonnes) {
      const [x, y] = this.transforme(p.etat.pos.x, p.etat.pos.z);
      const moi = p === course.moi;
      ctx.beginPath();
      ctx.arc(x, y, moi ? 5 : 3.6, 0, Math.PI * 2);
      ctx.fillStyle = moi ? '#34e0ff' : (p.humain ? '#ffd166' : 'rgba(232,237,248,0.75)');
      ctx.fill();
      if (moi) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(7,10,18,0.9)';
        ctx.stroke();
      }
    }
  }
}
