import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, ImageRun, WidthType, BorderStyle } from 'docx';
import { marked, Token, Tokens } from 'marked';

export async function exportToDocx(markdown: string): Promise<Blob> {
  const tokens = marked.lexer(markdown);
  const children: any[] = [];

  for (const token of tokens) {
    const elements = await processToken(token);
    if (elements) {
      if (Array.isArray(elements)) {
        children.push(...elements);
      } else {
        children.push(elements);
      }
    }
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "ordered-list",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: "start",
              style: {
                paragraph: {
                  indent: { left: 720, hanging: 360 },
                },
              },
            },
          ],
        },
      ],
    },
    sections: [{
      properties: {},
      children: children,
    }],
  });

  return Packer.toBlob(doc);
}

async function processToken(token: Token): Promise<any> {
  switch (token.type) {
    case 'heading': {
      const headingToken = token as Tokens.Heading;
      const level = [
        HeadingLevel.HEADING_1,
        HeadingLevel.HEADING_2,
        HeadingLevel.HEADING_3,
        HeadingLevel.HEADING_4,
        HeadingLevel.HEADING_5,
        HeadingLevel.HEADING_6,
      ][Math.min(headingToken.depth - 1, 5)];
      
      const inlineTokens = await processInlineTokens(headingToken.tokens);
      return new Paragraph({
        heading: level,
        children: inlineTokens.length > 0 ? inlineTokens : [new TextRun("")],
      });
    }
    case 'paragraph': {
      const paragraphToken = token as Tokens.Paragraph;
      // Check if paragraph contains only an image
      if (paragraphToken.tokens && paragraphToken.tokens.length === 1 && paragraphToken.tokens[0].type === 'image') {
        const imgToken = paragraphToken.tokens[0] as Tokens.Image;
        const imageRun = await createImageRun(imgToken.href);
        if (imageRun) {
          return new Paragraph({ children: [imageRun] });
        }
      }
      
      const inlineTokens = await processInlineTokens(paragraphToken.tokens);
      return new Paragraph({
        children: inlineTokens.length > 0 ? inlineTokens : [new TextRun("")],
      });
    }
    case 'table': {
      const tableToken = token as Tokens.Table;
      const rows = [];
      
      // Header
      const headerCells = await Promise.all(tableToken.header.map(async (cell) => {
        const inlineTokens = await processInlineTokens(cell.tokens);
        return new TableCell({
          children: [new Paragraph({ children: inlineTokens.length > 0 ? inlineTokens : [new TextRun("")] })],
          shading: { fill: "E0E0E0" },
          margins: { top: 100, bottom: 100, left: 100, right: 100 },
        });
      }));
      rows.push(new TableRow({ children: headerCells }));
      
      // Body
      for (const row of tableToken.rows) {
        const bodyCells = await Promise.all(row.map(async (cell) => {
          const inlineTokens = await processInlineTokens(cell.tokens);
          return new TableCell({
            children: [new Paragraph({ children: inlineTokens.length > 0 ? inlineTokens : [new TextRun("")] })],
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
          });
        }));
        rows.push(new TableRow({ children: bodyCells }));
      }
      
      return new Table({
        rows,
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
          left: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
          right: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
          insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
          insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
        }
      });
    }
    case 'list': {
      const listToken = token as Tokens.List;
      const listItems = [];
      for (const item of listToken.items) {
        const inlineTokens = await processInlineTokens(item.tokens);
        listItems.push(new Paragraph({
          children: inlineTokens.length > 0 ? inlineTokens : [new TextRun("")],
          bullet: listToken.ordered ? undefined : { level: 0 },
          numbering: listToken.ordered ? { reference: "ordered-list", level: 0 } : undefined,
        }));
      }
      return listItems;
    }
    case 'hr':
      return new Paragraph({
        children: [new TextRun("")],
        border: {
          bottom: {
            color: "auto",
            space: 1,
            style: BorderStyle.SINGLE,
            size: 6,
          },
        },
      });
    case 'space':
      return null;
    default:
      // Fallback for other block types
      if ('text' in token) {
        return new Paragraph({ children: [new TextRun(token.text || "")] });
      }
      return null;
  }
}

async function processInlineTokens(tokens?: Token[], format: { bold?: boolean, italics?: boolean } = {}): Promise<any[]> {
  if (!tokens) return [];
  const runs = [];
  
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'escape':
      case 'html': {
        const content = ('text' in token ? token.text : token.raw) || token.raw;
        const parts = content.split(/<br\s*\/?>/i);
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) runs.push(new TextRun({ break: 1 }));
          if (parts[i]) runs.push(new TextRun({ text: parts[i], bold: format.bold, italics: format.italics }));
        }
        break;
      }
      case 'br':
        runs.push(new TextRun({ break: 1 }));
        break;
      case 'strong':
        runs.push(...(await processInlineTokens((token as Tokens.Strong).tokens, { ...format, bold: true })));
        break;
      case 'em':
        runs.push(...(await processInlineTokens((token as Tokens.Em).tokens, { ...format, italics: true })));
        break;
      case 'codespan':
        runs.push(new TextRun({ text: token.raw, font: "Courier New", bold: format.bold, italics: format.italics }));
        break;
      case 'image': {
        const imgToken = token as Tokens.Image;
        const imageRun = await createImageRun(imgToken.href);
        if (imageRun) runs.push(imageRun);
        break;
      }
      case 'link': {
        const linkToken = token as Tokens.Link;
        runs.push(...(await processInlineTokens(linkToken.tokens, format)));
        break;
      }
      default:
        if ('text' in token) {
          runs.push(new TextRun({ text: token.raw, bold: format.bold, italics: format.italics }));
        }
    }
  }
  return runs;
}

async function createImageRun(href: string): Promise<ImageRun | null> {
  if (!href.startsWith('data:image/')) return null;
  
  try {
    // Extract base64 data
    const typeMatch = href.match(/^data:image\/(png|jpeg|jpg|gif|bmp);base64,/);
    const imgType = typeMatch ? typeMatch[1].replace('jpeg', 'jpg') : 'png';
    const base64Data = href.split(',')[1];
    const uint8Array = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    
    // Get image dimensions (approximate or fixed for now, docx requires dimensions)
    // To get actual dimensions, we'd need to load the image, which is async
    const dimensions = await getImageDimensions(href);
    
    // Scale down if too large (max width ~600px for word doc)
    const maxWidth = 600;
    let width = dimensions.width;
    let height = dimensions.height;
    
    if (width > maxWidth) {
      const ratio = maxWidth / width;
      width = maxWidth;
      height = height * ratio;
    }
    
    return new ImageRun({
      data: uint8Array,
      transformation: {
        width,
        height,
      },
      type: imgType as any,
    });
  } catch (e) {
    console.error("Failed to create image run", e);
    return null;
  }
}

function getImageDimensions(dataUrl: string): Promise<{width: number, height: number}> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.width, height: img.height });
    };
    img.onerror = () => {
      resolve({ width: 300, height: 300 }); // fallback
    };
    img.src = dataUrl;
  });
}
