#!/usr/bin/env python3
"""Variante claire du logo RUNEX pour le bon de livraison imprimé.

Usage : python3 scripts/brand/logo-impression.py apps/web/public/brand/runex-logo.jpeg apps/web/public/brand/runex-logo-impression.png 0.3

Fond noir → blanc, texte blanc → noir, facette sombre du R → gris, rouge conservé
(sans le halo lumineux), recadrage serré. Dépendances : Pillow, numpy."""
import sys
from PIL import Image
import numpy as np
src, out, gamma = sys.argv[1], sys.argv[2], float(sys.argv[3])
from PIL import ImageFilter
a = np.asarray(Image.open(src).convert('RGB').filter(ImageFilter.MedianFilter(5))).astype(float)
R,G,B = a[...,0],a[...,1],a[...,2]
neutral = np.minimum(R, np.maximum(G,B))          # composante grise
excess = np.clip(R - np.maximum(G,B), 0, 255)       # encre rouge
# Gris : le noir du fond devient blanc, le blanc du texte devient noir.
L = np.clip((neutral - 6) / (255 - 6), 0, 1)
gray = 255 * (1 - L**gamma)
gray = np.where(neutral <= 6, 255, gray)
# Voile du fond (bruit JPEG, lueur) : blanc franc, sinon il imprime en pavé gris.
gray = np.where(gray > 222, 255, gray)
# Rouge : on retire le halo (lueur sombre) et on pose une encre rouge franche.
alpha = np.clip((excess - 70) / (180 - 70), 0, 1)
red = np.array([214, 18, 24], float)
outa = gray[...,None] * (1 - alpha[...,None]) + red * alpha[...,None]
img = Image.fromarray(np.clip(outa,0,255).astype(np.uint8))
# Recadrage serré sur le dessin (+ marge).
mask = (outa.min(axis=2) < 235)
ys, xs = np.where(mask)
m = 8
box = (max(xs.min()-m,0), max(ys.min()-m,0), min(xs.max()+m, img.width), min(ys.max()+m, img.height))
img = img.crop(box)
img.save(out, optimize=True)
print(box, img.size)
