import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { cropImage } from './pdf-utils';

export async function processDocumentPage(
  base64Image: string, 
  onProgress: (text: string) => void
): Promise<string> {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });
  
  const config = {
    temperature: 0.1,
    // thinkingConfig: {
    //   thinkingLevel: ThinkingLevel.HIGH,
    // },
  };
  
  // Using gemma-4-31b-it as explicitly requested by the user
  const model = 'gemma-4-31b-it';
  
  // Extract mime type and base64 data
  const match = base64Image.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid base64 image");
  
  const mimeType = match[1];
  const data = match[2];

  const prompt = `Convert this document page to Markdown.
Extract all text and tables accurately. 
CRITICAL: You MUST convert all tables to standard Markdown tables (using | column | column | syntax). DO NOT output HTML <table> tags under any circumstances.
CRITICAL: Use actual newlines for line breaks. DO NOT use <br> or <br/> tags.
If there are any illustrations, charts, diagrams, or meaningful images in the document, please indicate them with ![image]
Do not include coordinates for text or tables, only for images/drawings.`;

  const contents = [
    {
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType,
            data,
          }
        },
        {
          text: prompt,
        },
      ],
    },
  ];

  try {
    const response = await ai.models.generateContentStream({
      model,
      config,
      contents,
    });
    
    let fullText = '';
    for await (const chunk of response) {
      if (chunk.text) {
        fullText += chunk.text;
        onProgress(fullText);
      }
    }
    
    // Post-process: find ![crop](...) and replace with actual cropped base64 images
    return await postProcessMarkdown(fullText, base64Image);
  } catch (error) {
    console.error("AI Generation Error with gemma-4-31b-it, falling back to gemini-3.1-flash-preview:", error);
    try {
      const fallbackResponse = await ai.models.generateContentStream({
        model: 'gemma-4-31b-it',
        config: { temperature: 0.1 },
        contents,
      });
      
      let fullText = '';
      for await (const chunk of fallbackResponse) {
        if (chunk.text) {
          fullText += chunk.text;
          onProgress(fullText);
        }
      }
      return await postProcessMarkdown(fullText, base64Image);
    } catch (fallbackError) {
      console.error("Fallback AI Generation Error:", fallbackError);
      throw fallbackError;
    }
  }
}

async function postProcessMarkdown(markdown: string, originalImageBase64: string): Promise<string> {
  const cropRegex = /!\[.*?\]\([^\d]*([\d.]+)[^\d]+([\d.]+)[^\d]+([\d.]+)[^\d]+([\d.]+)[^\d]*\)/g;
  let processedMarkdown = markdown;
  
  let match;
  // We need to do this sequentially or gather promises
  const replacements: { search: string, replace: string }[] = [];
  
  // Reset regex index
  cropRegex.lastIndex = 0;
  
  while ((match = cropRegex.exec(markdown)) !== null) {
    const [fullMatch, yminStr, xminStr, ymaxStr, xmaxStr] = match;
    const ymin = parseFloat(yminStr);
    const xmin = parseFloat(xminStr);
    const ymax = parseFloat(ymaxStr);
    const xmax = parseFloat(xmaxStr);
    
    try {
      const croppedBase64 = await cropImage(originalImageBase64, ymin, xmin, ymax, xmax);
      replacements.push({
        search: fullMatch,
        replace: `![image](${croppedBase64})`
      });
    } catch (e) {
      console.error("Failed to crop image", e);
    }
  }
  
  for (const { search, replace } of replacements) {
    processedMarkdown = processedMarkdown.replace(search, replace);
  }
  
  return processedMarkdown;
}
