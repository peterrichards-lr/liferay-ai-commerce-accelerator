const fs = require('fs');
const path = require('path');

/**
 * Media routes for managing placeholder images.
 */
module.exports = (router, { logger }) => {
  const placeholdersDir = path.join(__dirname, '..', 'public', 'placeholders');

  // Ensure directory exists
  if (!fs.existsSync(placeholdersDir)) {
    fs.mkdirSync(placeholdersDir, { recursive: true });
  }

  /**
   * List all available placeholder images.
   */
  router.get('/media/placeholders', (req, res) => {
    try {
      const files = fs.readdirSync(placeholdersDir);

      const placeholders = files
        .filter((file) => /\.(png|jpe?g|webp|gif|svg)$/i.test(file))
        .map((file) => {
          const ext = path.extname(file).toLowerCase();
          let mimeType = 'image/png';
          if (ext === '.webp') mimeType = 'image/webp';
          else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
          else if (ext === '.gif') mimeType = 'image/gif';
          else if (ext === '.svg') mimeType = 'image/svg+xml';

          // Derive label from filename: liferay_product_default.webp -> Liferay Product Default
          const label = file
            .replace(/\.[^/.]+$/, '') // Remove extension
            .split(/[_-]/) // Split by underscore or hyphen
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1)) // Capitalize each word
            .join(' '); // Join with space

          return {
            filename: file,
            label,
            mimeType,
            url: `/placeholders/${file}`,
          };
        });

      res.status(200).json({ success: true, placeholders });
    } catch (error) {
      logger.error('Failed to list placeholders', { error: error.message });
      res
        .status(500)
        .json({ success: false, error: 'Failed to list placeholders' });
    }
  });

  /**
   * Get base64 content of a placeholder.
   */
  router.get('/media/placeholders/:filename/base64', (req, res) => {
    const { filename } = req.params;
    const safeFilename = path.basename(filename);
    const filePath = path.join(placeholdersDir, safeFilename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    try {
      const buffer = fs.readFileSync(filePath);
      const base64 = buffer.toString('base64');
      const ext = path.extname(filename).toLowerCase();
      let mimeType = 'image/png';
      if (ext === '.webp') mimeType = 'image/webp';
      else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';

      res.status(200).json({ success: true, base64, mimeType });
    } catch (error) {
      logger.error('Failed to read placeholder', {
        error: error.message,
        filename,
      });
      res
        .status(500)
        .json({ success: false, error: 'Failed to read placeholder' });
    }
  });

  /**
   * Upload a new placeholder image.
   */
  router.post('/media/placeholders', (req, res) => {
    const { label, mimeType, base64, filename: providedFilename } = req.body;

    if (!base64 || !mimeType) {
      return res.status(400).json({ success: false, error: 'Missing data' });
    }

    try {
      const ext = mimeType.split('/')[1] || 'png';
      // Sanitize label to use as filename: "My Custom Label" -> "my_custom_label"
      const cleanLabel = (label || 'custom')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_') // Replace non-alphanumeric with underscores
        .replace(/^_+|_+$/g, ''); // Trim leading/trailing underscores

      const filename = providedFilename
        ? path.basename(providedFilename)
        : `${cleanLabel}.${ext}`;
      let filePath = path.join(placeholdersDir, filename);

      // Avoid overwriting by adding a suffix if file exists
      if (fs.existsSync(filePath)) {
        const uniqueFilename = `${cleanLabel}_${Date.now()}.${ext}`;
        filePath = path.join(placeholdersDir, uniqueFilename);
      }

      const buffer = Buffer.from(
        base64.replace(/^data:image\/[a-z]+;base64,/, ''),
        'base64'
      );
      fs.writeFileSync(filePath, buffer);

      logger.info('Uploaded new placeholder', {
        filename: path.basename(filePath),
        label,
      });

      res.status(200).json({
        success: true,
        placeholder: {
          filename: path.basename(filePath),
          label: label || path.basename(filePath),
          mimeType,
          url: `/placeholders/${path.basename(filePath)}`,
        },
      });
    } catch (error) {
      logger.error('Failed to upload placeholder', { error: error.message });
      res
        .status(500)
        .json({ success: false, error: 'Failed to upload placeholder' });
    }
  });

  /**
   * Delete a placeholder image.
   */
  router.delete('/media/placeholders/:filename', (req, res) => {
    const { filename } = req.params;
    const safeFilename = path.basename(filename);
    const filePath = path.join(placeholdersDir, safeFilename);

    // Prevent deleting standard ones if we want to be safe, but user said "uploaded images should be saved in the same location ... so they too can be displayed"
    // Maybe we just allow it.

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    try {
      fs.unlinkSync(filePath);
      logger.info('Deleted placeholder', { filename });
      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('Failed to delete placeholder', {
        error: error.message,
        filename,
      });
      res
        .status(500)
        .json({ success: false, error: 'Failed to delete placeholder' });
    }
  });
};
