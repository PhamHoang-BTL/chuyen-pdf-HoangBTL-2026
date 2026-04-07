import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Set worker source to local file via Vite to avoid CDN issues
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export async function convertPdfToImages(file: File): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = Math.min(pdf.numPages, 10); // Limit to 10 pages
  const images: string[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better quality
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) continue;
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport } as any).promise;
    images.push(canvas.toDataURL('image/jpeg', 0.8));
  }

  return images;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
}

export async function cropImage(base64Image: string, y1: number, x1: number, y2: number, x2: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject('No context');
      
      const xmin = Math.min(x1, x2);
      const xmax = Math.max(x1, x2);
      const ymin = Math.min(y1, y2);
      const ymax = Math.max(y1, y2);
      
      let width = (xmax - xmin) * img.width;
      let height = (ymax - ymin) * img.height;
      
      if (width <= 0) width = img.width;
      if (height <= 0) height = img.height;
      
      canvas.width = width;
      canvas.height = height;
      
      ctx.drawImage(
        img,
        xmin * img.width, ymin * img.height, width, height,
        0, 0, width, height
      );
      
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = reject;
    img.src = base64Image;
  });
}
