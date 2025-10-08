const { jsPDF } = require('jspdf');
const { ObjectStorageService } = require('./objectStorage.cjs');
const { ConfigService } = require('./configService.cjs');
const { buildDataUrl, parseDataUrl } = require('../utils/misc.cjs');

const MOCK_BASE64_IMAGE = {
  mimeType: 'image/webp',
  base64:
    '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',
};

const MOCK_BASE64_PDF = {
  mimeType: 'application/pdf',
  base64:
    'JVBERi0xLjMKJcTl8uXrp/Og0MTGCjQgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL091dGxpbmVzIDIgMCBSCi9QYWdlcyAzIDAgUgo+PgplbmRvYmoKCjIgMCBvYmoKPDwKL1R5cGUgL091dGxpbmVzCi9Db3VudCAwCj4+CmVuZG9iagoKMyAwIG9iago8PAovVHlwZSAvUGFnZXMKL0NvdW50IDEKL0tpZHMgWzQgMCBSXQo+PgplbmRvYmoKCjQgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAzIDAgUgovUmVzb3VyY2VzIDw8Ci9Gb250IDw8Ci9GMSA5IDAgUgo+Pgo+PgovTWVkaWFCb3ggWzAuMDAwIDAuMDAwIDYxMi4wMDAgNzkyLjAwMF0KL0NvbnRlbnRzIDUgMCBSCj4+CmVuZG9iagoKNSAwIG9iago8PAovTGVuZ3RoIDQ0Cj4+CnN0cmVhbQpCVAovRjEgMTggVGYKNTcuMzc1IDcyMi4yOCBUZAooUHJvZHVjdCBEb2N1bWVudGF0aW9uKSBUagpFVAplbmRzdHJlYW0KZW5kb2JqCgo2IDAgb2JqCjw8Ci9UeXBlIC9Gb250Ci9TdWJ0eXBlIC9UeXBlMQovQmFzZUZvbnQgL1RpbWVzLVJvbWFuCj4+CmVuZG9iagoKOSAwIG9iago8PAovVHlwZSAvRm9udAovU3VidHlwZSAvVHlwZTEKL0Jhc2VGb250IC9IZWx2ZXRpY2EKPj4KZW5kb2JqCgp4cmVmCjAgMTAKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNzQgMDAwMDAgbiAKMDAwMDAwMDEyMCAwMDAwMCBuIAowMDAwMDAwMTc3IDAwMDAwIG4gCjAwMDAwMDAzNjQgMDAwMDAgbiAKMDAwMDAwMDQ2NiAwMDAwMCBuIAowMDAwMDAwNTMzIDAwMDAwIG4gCjAwMDAwMDA1NjEgMDAwMDAgbiAKMDAwMDAwMDU4OSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDEwCi9Sb290IDEgMCBSCj4+CnN0YXJ0eHJlZgo2NTcKJSVFT0Y=',
};

class MediaGenerator {
  constructor() {
    this.objectStorage = new ObjectStorageService();
    this.configService = new ConfigService();
  }

  getMockBase64Image = () => MOCK_BASE64_IMAGE;

  getMockBase64Pdf = () => MOCK_BASE64_PDF;

  async getDefaultBase64ImageDataUrl(config) {
    const image = await this.getDefaultBase64Image(config);
    return buildDataUrl(image);
  }

  async getDefaultBase64Image(config) {
    try {
      const dataUrl = await this.configService.getDefaultImage(config);
      return parseDataUrl(dataUrl);
    } catch (err) {
      logger.error(
        'Unexpected error while retrieving the default image. Using the mock image',
        err
      );
      return this.getMockBase64Image();
    }
  }

  async getgetDefaultBase64PdfDataUrl(config) {
    const pdf = await this.getDefaultBase64Pdf(config);
    return buildDataUrl(pdf);
  }

  async getDefaultBase64Pdf(config) {
    try {
      const dataUrl = await this.configService.getDefaultPdf(config);
      return parseDataUrl(dataUrl);
    } catch (err) {
      logger.error(
        'Unexpected error while retrieving the default pdf. Using the mock pdf',
        err
      );
      return this.getMockBase64Pdf();
    }
  }

  async generateImageData(
    baseName,
    width,
    height = width,
    format = undefined,
    preventCache = true,
    grayscale = false,
    blur = undefined,
    seed = undefined,
    id = undefined
  ) {
    const actualWidth = width ? Math.floor(width) : 1;
    const actualHeight = height ? Math.floor(height) : 1;
    const isSquare = actualWidth === actualHeight;

    let url = 'https://picsum.photos/';

    if (seed && !id) {
      url += `seed/${seed}/`;
    }

    url += isSquare ? `${actualWidth}` : `${actualWidth}/${actualHeight}`;

    if (id && !seed) {
      url += `/${id}`;
    }

    if (format === 'webp' || format === 'jpg') {
      url += `.${format}`;
    }

    if (preventCache && !seed && !id) {
      url += `?random=${new Date().getTime()}`;
    }

    if (grayscale) {
      url += (url.indexOf('?') ? '&' : '?') + 'grayscale';
    }

    if (blur) {
      if (isNaN(blur)) {
        url += (url.indexOf('?') ? '&' : '?') + 'blur';
      } else {
        const blurIndex = parseInt(blur);
        if (blurIndex >= 1 && blurIndex <= 10) {
          url += (url.indexOf('?') ? '&' : '?') + `blur=${blurIndex}`;
        } else {
          url += (url.indexOf('?') ? '&' : '?') + 'blur';
        }
      }
    }

    return {
      title: { en_US: `${baseName} Product Image` },
      type: 'image',
      src: url,
      priority: 1,
    };
  }

  async generateProductPDF(pdfContent, productSku) {
    try {
      // Create new PDF document with explicit options to ensure compatibility
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'a4',
        hotfixes: ['px_scaling'],
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 40;
      const maxWidth = pageWidth - margin * 2;
      let currentY = margin;

      // Ensure we have valid content
      const title =
        pdfContent?.title || `Product Documentation - ${productSku}`;
      const sections = pdfContent?.sections || [
        {
          title: 'Product Information',
          content: `This is a sample product documentation for ${productSku}. This document contains basic product information and specifications.`,
        },
      ];

      // Add title
      doc.setFontSize(24);
      doc.setFont('helvetica', 'bold');
      const titleLines = doc.splitTextToSize(title, maxWidth);
      titleLines.forEach((line) => {
        doc.text(line, margin, currentY);
        currentY += 30;
      });
      currentY += 20;

      // Add each section
      for (const section of sections) {
        // Check if we need a new page
        if (currentY > pageHeight - 100) {
          doc.addPage();
          currentY = margin;
        }

        // Section title
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        const sectionTitle = section.title || 'Section';
        doc.text(sectionTitle, margin, currentY);
        currentY += 25;

        // Section content
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');

        const content = section.content || 'Content not available.';
        const lines = doc.splitTextToSize(content, maxWidth);
        for (const line of lines) {
          if (currentY > pageHeight - 80) {
            doc.addPage();
            currentY = margin;
          }
          doc.text(line, margin, currentY);
          currentY += 15;
        }
        currentY += 20; // Space between sections
      }

      // Add footer to all pages
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(
          `Generated by Liferay AI Data Generator - Page ${i} of ${pageCount}`,
          margin,
          pageHeight - 30
        );
        doc.text(
          `Product SKU: ${productSku}`,
          pageWidth - margin - 120,
          pageHeight - 30
        );
      }

      // Use datauri string instead of arraybuffer for better compatibility
      const pdfOutput = doc.output('datauri');

      // Convert datauri to buffer
      const base64Data = pdfOutput.split(',')[1];
      return Buffer.from(base64Data, 'base64');
    } catch (error) {
      logger.error('Error generating PDF:', error);
      throw error;
    }
  }

  async uploadPDFToStorage(uploadURL, pdfBuffer, filename) {
    try {
      // Upload PDF to object storage
      const response = await fetch(uploadURL, {
        method: 'PUT',
        body: pdfBuffer,
        headers: {
          'Content-Type': 'application/pdf',
          Connection: 'keep-alive',
        },
        // Set a timeout for the request
        signal: AbortSignal.timeout(60000), // 60 second timeout
      });

      if (!response.ok) {
        throw new Error(
          `Failed to upload PDF: ${response.statusText} (Status: ${response.status})`
        );
      }

      // Normalize the path for object entity access
      const objectPath =
        this.objectStorage.normalizeObjectEntityPath(uploadURL);

      return {
        objectPath,
        uploadURL,
        filename,
      };
    } catch (error) {
      logger.error('Error uploading PDF:', error);
      // It's good practice to re-throw the error after logging if the caller needs to handle it
      throw error;
    }
  }

  async generateAndUploadProductPDF(productData, productSku) {
    try {
      logger.trace(`Generating PDF for product: ${productSku}`);

      const pdfBuffer = await this.generateProductPDF(productData, productSku);

      // Validate PDF buffer
      if (!pdfBuffer || pdfBuffer.length === 0) {
        throw new Error('Generated PDF buffer is empty');
      }

      // Check if PDF starts with proper PDF header
      const pdfHeader = pdfBuffer.slice(0, 4).toString();
      if (pdfHeader !== '%PDF') {
        throw new Error('Generated PDF does not have valid PDF header');
      }

      // Store in object storage
      logger.trace(`Uploading PDF to object storage...`);
      const objectKey = `product-pdfs/${productSku}-${Date.now()}.pdf`;
      const uploadResult = await this.objectStorage.uploadFile(
        objectKey,
        pdfBuffer,
        'application/pdf'
      );

      logger.trace(
        `✓ PDF generated and uploaded successfully for ${productSku}`
      );

      return {
        objectPath: uploadResult.objectPath,
        fileName: `${productSku}_product_manual.pdf`,
        buffer: pdfBuffer,
      };
    } catch (error) {
      logger.error(`Failed to generate PDF for ${productSku}:`, error);
      throw error;
    }
  }

  // Determine which products should get PDFs based on ratio (deterministic selection)
  selectProductsForPDFs(products, ratio) {
    if (ratio <= 0 || ratio > 100) return [];

    const count = Math.ceil(products.length * (ratio / 100));

    // Deterministic selection based on stable sort by externalReferenceCode
    const sortedProducts = [...products].sort((a, b) => {
      const aRef =
        a.externalReferenceCode || a.sku || `product-${products.indexOf(a)}`;
      const bRef =
        b.externalReferenceCode || b.sku || `product-${products.indexOf(b)}`;
      return aRef.localeCompare(bRef);
    });
    return sortedProducts.slice(0, count);
  }

  // Determine which products should get images based on ratio (deterministic selection)
  selectProductsForImages(products, ratio) {
    if (ratio <= 0 || ratio > 100) return [];

    const count = Math.ceil(products.length * (ratio / 100));

    // Deterministic selection based on stable sort by externalReferenceCode
    const sortedProducts = [...products].sort((a, b) => {
      const aRef =
        a.externalReferenceCode || a.sku || `product-${products.indexOf(a)}`;
      const bRef =
        b.externalReferenceCode || b.sku || `product-${products.indexOf(b)}`;
      return aRef.localeCompare(bRef);
    });
    return sortedProducts.slice(0, count);
  }
}

module.exports = { MediaGenerator };
