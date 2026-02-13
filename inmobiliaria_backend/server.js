const express = require("express")
const cors = require("cors")
const mysql = require("mysql2")
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")
const multer = require("multer")
const path = require("path")
const fs = require("fs")
const nodemailer = require("nodemailer")
const app = express()
const inversionesRouter = require("./inversiones");
// Enhanced CORS for ngrok
app.use(cors({
  origin: true, // Allow all origins (important for ngrok and external devices)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}))
//app.use(express.json({ limit: "50mb" }))    mal 
//app.use(express.urlencoded({ limit: "50mb" }))   mal
////
// Middleware especial para ngrok - HEADERS
app.use((req, res, next) => {
  // Asegurar que las respuestas tengan headers correctos para ngrok
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range'
  });
  
  // Para preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Middleware para servir archivos estáticos con headers correctos
app.use("/uploads", (req, res, next) => {
  // Set headers para archivos estáticos
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=31536000'
  });
  express.static(path.join(__dirname, "uploads"))(req, res, next);
});
//////
////
////
///
///
///
//
// ==========================
// MULTER SETUP
// ==========================
// ==========================
// BODY PARSING (sin body-parser)
// ==========================
app.use(express.json({ limit: "50mb" }))
app.use(express.urlencoded({ limit: "50mb", extended: true }))
app.use("/api/inversiones", inversionesRouter);





const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "uploads")
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    cb(null, dir)
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safe = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, safe);
  },
})

const upload = multer({ storage })

// Serve static uploads folder
app.use("/uploads", express.static(path.join(__dirname, "uploads")))

// Image Proxy Endpoint - Solves ngrok image loading issues
// Returns images with proper CORS headers and ngrok compatibility
app.get("/image/:filename", (req, res) => {
  const filename = req.params.filename
  const filepath = path.join(__dirname, "uploads", filename)
  
  // Security: ensure the file is in the uploads directory
  const realPath = path.resolve(filepath)
  const uploadsDir = path.resolve(path.join(__dirname, "uploads"))
  
  if (!realPath.startsWith(uploadsDir)) {
    return res.status(403).json({ error: "Acceso denegado" })
  }
  
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: "Archivo no encontrado" })
  }
  
  // Set proper headers for image serving
  res.set({
    'Content-Type': 'image/jpeg', // Could be more sophisticated based on file ext
    'Cache-Control': 'public, max-age=3600',
    'Access-Control-Allow-Origin': '*',
  })
  
  res.sendFile(filepath)
})

// Proxy endpoint for PDF downloads that handles any URL
app.get("/download-pdf/:filename", (req, res) => {
  const filename = req.params.filename
  const filepath = path.join(__dirname, "uploads", filename)
  
  // Security: ensure the file is in the uploads directory
  const realPath = path.resolve(filepath)
  const uploadsDir = path.resolve(path.join(__dirname, "uploads"))
  
  if (!realPath.startsWith(uploadsDir)) {
    return res.status(403).json({ error: "Acceso denegado" })
  }
  
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: "Archivo no encontrado" })
  }
  
  res.download(filepath, filename, (err) => {
    if (err) {
      console.error("[v0] Download error:", err)
    }
  })
})

// Convierte errores de Multer a JSON (evita HTML 500)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `MulterError: ${err.message}` })
  }
  if (err) {
    return res.status(500).json({ error: err.message || "Error interno" })
  }
  next()
})

const SECRET = "baa123456789"

// Helper function to generate file URLs
// Uses the /image proxy endpoint which handles CORS and ngrok properly
// This ensures images load correctly through ngrok tunneling
function getFileUrl(filename, req) {
  const ext = path.extname(filename || '').toLowerCase();
  const isPdf = ext === '.pdf';
  
  const protocol = req.protocol || (req.get('x-forwarded-proto') === 'https' ? 'https' : 'http');
  const host = req.get('host') || req.hostname || 'localhost:3000';
  
  if (isPdf) {
    return `${protocol}://${host}/download-pdf/${filename}`;
  } else {
    return `${protocol}://${host}/image/${filename}`;
  }
}
// Helper to regenerate URLs in response data
// Extracts filename from stored URL and rebuilds with current host/protocol
function regenerateImageUrl(storedUrl, req) {
  if (!storedUrl) return null;
  
  // Extract just the filename from the stored URL
  // Examples: "https://old-ngrok.app/image/file.jpg" or "http://localhost:3000/uploads/file.jpg"
  let filename = storedUrl;
  
  // Remove protocol and host
  filename = filename.replace(/^https?:\/\/[^\/]+\/(?:image|uploads)\//, '');
  // Also handle case where it's just the filename
  filename = filename.split('/').pop(); // Get last part after any slashes
  
  if (!filename) return storedUrl; // Return original if we can't extract
  
  // Return fresh URL with current host
  return getFileUrl(filename, req);
}

// Helper to regenerate all image URLs in an array of objects
function regenerateImageUrlsInArray(items, req, imageFields = ['image_url', 'primary_image']) {
  return items.map(item => {
    const updated = { ...item };
    imageFields.forEach(field => {
      if (updated[field]) {
        updated[field] = regenerateImageUrl(updated[field], req);
      }
    });
    return updated;
  });
}

const db = require("./db")


db.connect((err) => {
  if (err) console.error("Error BD:", err)
  else console.log("✓ BD conectada correctamente")
})

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "vivianvillarroel5@gmail.com",
    pass: "tnoz rgxe erqg lsqv",
  },
})

// ==========================
// HELPERS
// ==========================
function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch (e) {
    console.log("No se pudo borrar archivo:", filePath, e?.message)
  }
}

function parseBoolToTinyint(v) {
  return v === "1" || v === "true" || v === true ? 1 : 0
}

function parseCsvIds(v) {
  if (!v) return []
  if (Array.isArray(v)) {
    return v.map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n))
  }
  return String(v)
    .split(",")
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n))
}
function ensurePrimaryImage(propertyId, cb = () => { }) {
  db.query(
    `SELECT id, is_primary, display_order 
     FROM property_images 
     WHERE property_id=? 
     ORDER BY display_order ASC, id ASC`,
    [propertyId],
    (err, rows) => {
      if (err) return cb(err);
      if (!rows || rows.length === 0) return cb(null);

      const primaryRows = rows.filter(r => r.is_primary === 1 || r.is_primary === true);
      const keepId = (primaryRows[0]?.id) ?? rows[0].id;

      db.query(
        `UPDATE property_images 
         SET is_primary = CASE WHEN id=? THEN 1 ELSE 0 END
         WHERE property_id=?`,
        [keepId, propertyId],
        (err2) => cb(err2 || null),
      );
    }
  );
}

// ==========================
// 🔐 AUTENTICACIÓN
// ==========================
app.post("/register", (req, res) => {
  const { email, password, name, phone, role = "user" } = req.body

  const hashedPassword = bcrypt.hashSync(password, 8)

  db.query(
    "INSERT INTO users(email, password, name, phone, role) VALUES(?, ?, ?, ?, ?)",
    [email, hashedPassword, name, phone, role],
    (err, result) => {
      if (err) return res.status(400).json({ error: "Email ya existe" })

      const token = jwt.sign({ id: result.insertId, role: role }, SECRET)

      res.json({ token, role, id: result.insertId })
    },
  )
})

app.post("/login", (req, res) => {
  const { email, password } = req.body

  db.query("SELECT id, email, password, name, phone, role FROM users WHERE email=?", [email], (err, result) => {
    if (result.length === 0) return res.status(401).json({ error: "Usuario no existe" })

    const user = result[0]

    if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: "Contraseña incorrecta" })

    const token = jwt.sign({ id: user.id, role: user.role }, SECRET)

    res.json({
      token,
      role: user.role,
      id: user.id,
      name: user.name,
      email: user.email,
    })
  })
})

app.post("/forgot-password", (req, res) => {
  const { email } = req.body

  db.query("SELECT id, email, name FROM users WHERE email=?", [email], (err, result) => {
    if (result.length === 0) return res.status(404).json({ error: "Email no registrado" })

    const user = result[0]
    const resetToken = jwt.sign({ id: user.id, email: user.email }, SECRET, { expiresIn: "1h" })
    const resetLink = `/uploads//reset-password?token=${resetToken}`

    const mailOptions = {
      from: "vivianvillarroe5@gmail.com",
      to: email,
      subject: "Recuperar contraseña - Inmobiliaria Createcto",
      html: `
        <h2>Hola ${user.name},</h2>
        <p>Haz clic en el siguiente enlace para recuperar tu contraseña:</p>
        <a href="${resetLink}">Recuperar contraseña</a>
        <p>Este enlace expirará en 1 hora.</p>
      `,
    }

    transporter.sendMail(mailOptions, (err2) => {
      if (err2) return res.status(500).json({ error: "Error al enviar correo" })
      res.json({ message: "Correo enviado. Verifica tu bandeja de entrada" })
    })
  })
})

app.post("/reset-password", (req, res) => {
  const { token, newPassword } = req.body

  try {
    const decoded = jwt.verify(token, SECRET)
    const hashedPassword = bcrypt.hashSync(newPassword, 8)

    db.query("UPDATE users SET password=? WHERE id=?", [hashedPassword, decoded.id], (err) => {
      if (err) return res.status(500).json({ error: err })
      res.json({ message: "Contraseña actualizada" })
    })
  } catch (err) {
    res.status(401).json({ error: "Token inválido o expirado" })
  }
})

// ==========================
// 👀 PROPIEDADES (GUEST/TODOS)
// ==========================
app.get("/properties", (req, res) => {
  const { search, minPrice, maxPrice, city, property_type, transaction_type } = req.query
  const today = new Date().toISOString().split("T")[0]

  let query = `SELECT p.*, 
    (SELECT image_url FROM property_images WHERE property_id = p.id AND is_primary = true LIMIT 1) as primary_image,
    (SELECT GROUP_CONCAT(image_url) FROM property_images WHERE property_id = p.id) as images,
    CASE 
      WHEN p.is_featured = true AND p.featured_start <= ? AND p.featured_end >= ? THEN 1 
      ELSE 0 
    END as currently_featured
    FROM properties p WHERE p.approved = true`
  const params = [today, today]

  if (search) {
    query += " AND (p.title LIKE ? OR p.description LIKE ?)"
    params.push(`%${search}%`, `%${search}%`)
  }
  if (minPrice) {
    query += " AND p.price >= ?"
    params.push(minPrice)
  }
  if (maxPrice) {
    query += " AND p.price <= ?"
    params.push(maxPrice)
  }
  if (city) {
    query += " AND (p.address LIKE ? OR p.city LIKE ?)"
    params.push(`%${city}%`, `%${city}%`)
  }
  if (property_type && property_type !== "todas") {
    query += " AND LOWER(p.property_type) = LOWER(?)"
    params.push(property_type)
  }
  if (transaction_type && transaction_type !== "todas") {
    query += " AND LOWER(p.transaction_type) = LOWER(?)"
    params.push(transaction_type)
  }

  query += " ORDER BY currently_featured DESC, p.created_at DESC"

  db.query(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err })
    // Regenerate image URLs to use current host/protocol (fixes ngrok issues)
    rows = regenerateImageUrlsInArray(rows, req, ['primary_image', 'images']);
    res.json(rows)
  })
})
app.get("/properties/:id", (req, res) => {
  db.query(
    `SELECT p.*, u.phone as owner_phone, u.name as owner_name, p.contact_phone,
    (SELECT GROUP_CONCAT(image_url) FROM property_images WHERE property_id = p.id) as images
    FROM properties p 
    LEFT JOIN users u ON p.user_id = u.id
    WHERE p.id=?`,
    [req.params.id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err })
      if (result.length === 0) return res.status(404).json({ error: "No encontrada" })
      
      // Regenera la URL de las imágenes
      const property = result[0];
      if (property.images) {
        const imageUrls = property.images.split(',');
        const regeneratedUrls = imageUrls.map(url => regenerateImageUrl(url, req));
        property.images = regeneratedUrls.join(',');
      }
      
      res.json(property)
    },
  )
})

// ==========================
// 🎨 BANNERS/PUBLICIDADES
// ==========================
app.get("/banners", (req, res) => {
  const today = new Date().toISOString().split("T")[0]
  db.query(
  `SELECT * FROM banners
  WHERE is_active = true
  AND start_date <= ?
  AND end_date >= ?
  ORDER BY created_at DESC`,
  [today, today],
  (err, result) => {
  if (err) return res.status(500).json({ error: err })
  // Regenerate image URLs to use current host/protocol (fixes ngrok issues)
  const updated = regenerateImageUrlsInArray(result, req, ['image_url', 'image_path']);
  res.json(updated)
  },
  )
  })

app.get("/admin/banners", (req, res) => {
  db.query(`SELECT * FROM banners ORDER BY created_at DESC`, (err, result) => {
    if (err) return res.status(500).json({ error: err })
    res.json(result)
  })
})

app.post("/admin/banners", upload.single("image"), (req, res) => {
  const { title, description, start_date, end_date, link, is_active, payment_amount } = req.body

  // Validaciones
  if (!title || title.trim().length === 0) {
    if (req.file) safeUnlink(req.file.path)
    return res.status(400).json({ error: "El título es requerido" })
  }

  if (!req.file) {
    return res.status(400).json({ error: "La imagen es requerida" })
  }

  // Validar que el archivo existe
  if (!fs.existsSync(req.file.path)) {
    return res.status(400).json({ error: "Error: el archivo de imagen no se guardó correctamente" })
  }

  const imageUrl = getFileUrl(req.file.filename, req);
  const imagePath = req.file.path
  const activeStatus = parseBoolToTinyint(is_active)

  db.query(
    `INSERT INTO banners(title, description, image_path, image_url, start_date, end_date, link, is_active, payment_amount)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, description, imagePath, imageUrl, start_date, end_date, link || null, activeStatus, payment_amount || 0],
    (err, result) => {
      if (err) {
        safeUnlink(imagePath)
        return res.status(500).json({ error: err.message || "Error al crear banner" })
      }
      res.json({ id: result.insertId, message: "Banner creado exitosamente" })
    },
  )
})

app.put("/admin/banners/:id", upload.single("image"), (req, res) => {
  const { title, description, start_date, end_date, link, is_active, payment_amount } = req.body
  const bannerId = req.params.id

  // Validaciones
  if (!title || title.trim().length === 0) {
    if (req.file) safeUnlink(req.file.path)
    return res.status(400).json({ error: "El título es requerido" })
  }

  db.query("SELECT * FROM banners WHERE id = ?", [bannerId], (err, result) => {
    if (err) {
      if (req.file) safeUnlink(req.file.path)
      return res.status(500).json({ error: err.message })
    }
    if (result.length === 0) {
      if (req.file) safeUnlink(req.file.path)
      return res.status(404).json({ error: "Banner no encontrado" })
    }

    let finalImageUrl = result[0].image_url
    let imagePath = result[0].image_path
    const oldImagePath = result[0].image_path

    if (req.file) {
      // Validar que el archivo nuevo existe
      if (!fs.existsSync(req.file.path)) {
        return res.status(400).json({ error: "Error: el archivo de imagen no se guardó correctamente" })
      }
      finalImageUrl = getFileUrl(req.file.filename, req)
      imagePath = req.file.path
    }

    const activeStatus = parseBoolToTinyint(is_active)

    db.query(
      `UPDATE banners SET title=?, description=?, image_path=?, image_url=?, start_date=?, end_date=?, link=?, is_active=?, payment_amount=? WHERE id=?`,
      [
        title,
        description,
        imagePath,
        finalImageUrl,
        start_date,
        end_date,
        link || null,
        activeStatus,
        payment_amount || 0,
        bannerId,
      ],
      (err2) => {
        if (err2) {
          if (req.file) safeUnlink(req.file.path)
          return res.status(500).json({ error: err2.message || "Error al actualizar banner" })
        }
        // Borrar imagen vieja si se subió una nueva
        if (req.file && oldImagePath) {
          safeUnlink(oldImagePath)
        }
        res.json({ message: "Banner actualizado exitosamente" })
      },
    )
  })
})

app.delete("/admin/banners/:id", (req, res) => {
  db.query("DELETE FROM banners WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err })
    res.json({ message: "Banner eliminado" })
  })
})

app.put("/admin/banners/:id/toggle", (req, res) => {
  const bannerId = req.params.id
  db.query("UPDATE banners SET is_active = NOT is_active WHERE id = ?", [bannerId], (err) => {
    if (err) return res.status(500).json({ error: err })
    res.json({ message: "Estado del banner actualizado" })
  })
})

// ==========================
// 💾 FAVORITOS
// ==========================
app.post("/favorites", (req, res) => {
  const { user_id, property_id } = req.body

  db.query(
    "INSERT INTO favorites(user_id, property_id) VALUES(?, ?) ON DUPLICATE KEY UPDATE id=id",
    [user_id, property_id],
    (err) => {
      if (err) return res.status(400).json({ error: "Ya en favoritos" })
      res.json({ message: "Agregado a favoritos" })
    },
  )
})
app.get("/favorites/:user_id", (req, res) => {
  const today = new Date().toISOString().split("T")[0]
  db.query(
    `SELECT p.*,
    (SELECT image_url FROM property_images WHERE property_id = p.id AND is_primary = true LIMIT 1) as primary_image,
    CASE 
      WHEN p.is_featured = true AND p.featured_start <= ? AND p.featured_end >= ? THEN 1 
      ELSE 0 
    END as currently_featured
    FROM properties p
    JOIN favorites f ON p.id = f.property_id
    WHERE f.user_id = ?`,
    [today, today, req.params.user_id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err })
      
      // REGENERA LAS URLs usando el helper
      const updatedResult = regenerateImageUrlsInArray(result, req, ['primary_image']);
      
      res.json(updatedResult)
    },
  )
})

app.delete("/favorites/:user_id/:property_id", (req, res) => {
  db.query(
    "DELETE FROM favorites WHERE user_id=? AND property_id=?",
    [req.params.user_id, req.params.property_id],
    (err) => {
      if (err) return res.status(500).json({ error: err })
      res.json({ message: "Eliminado de favoritos" })
    },
  )
})

// ==========================
// 📋 CONSULTAS/INQUIRIES
// ==========================
app.post("/inquiries", (req, res) => {
  const { user_id, property_id, message } = req.body

  db.query("INSERT INTO inquiries(user_id, property_id, message) VALUES(?, ?, ?)", [user_id, property_id, message], (err, result) => {
    if (err) return res.status(500).json({ error: err })
    res.json({ id: result.insertId, message: "Consulta enviada" })
  })
})

app.get("/inquiries/:user_id", (req, res) => {
  db.query(
    `SELECT i.*, p.title, p.image 
     FROM inquiries i
     JOIN properties p ON i.property_id = p.id
     WHERE i.user_id = ?`,
    [req.params.user_id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err })
      res.json(result)
    },
  )
})

// ==========================
// 🏢 PROPIEDADES DEL USUARIO
// ==========================

// CREAR (se queda igual: usa "images")
app.post("/user/properties", upload.array("images", 10), (req, res) => {
  const {
    title,
    description,
    price,
    currency,
    address,
    city,
    user_id,
    latitude,
    longitude,
    bedrooms,
    bathrooms,
    area,
    land_area,
    property_type,
    transaction_type,
    is_admin,
    contact_phone,
  } = req.body

  if (!req.files || req.files.length === 0) {
    console.error("[v0] Property creation: no files uploaded")
    return res.status(400).json({ error: "Al menos una imagen es requerida" })
  }
  
  console.log("[v0] Property creation:", { 
    title, 
    filesCount: req.files.length, 
    files: req.files.map(f => ({ name: f.filename, size: f.size, path: f.path }))
  })
  
  const isApproved = is_admin === "true" || is_admin === true

  db.query(
    `INSERT INTO properties(title, description, price, currency, address, city, user_id, latitude, longitude, 
      bedrooms, bathrooms, area, land_area, property_type, transaction_type, approved, rejected, contact_phone)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false, ?)`,
    [
      title,
      description,
      price,
      currency || "BS",
      address,
      city,
      user_id,
      latitude,
      longitude,
      bedrooms || 0,
      bathrooms || 0,
      area || 0,
      land_area || 0,
      property_type || "casa",
      transaction_type || "venta",
      isApproved,
      contact_phone || null,
  ],
  (err, result) => {
    if (err) {
      console.error("[v0] Property insertion error:", err)
      return res.status(500).json({ error: "Error al crear propiedad: " + (err.message || err) })
    }

      const propertyId = result.insertId
      let uploadedCount = 0

      req.files.forEach((file, index) => {
        const image_url = getFileUrl(file.filename, req);
        const is_primary = index === 0 ? true : false

        db.query(
          `INSERT INTO property_images(property_id, image_path, image_url, display_order, is_primary)
           VALUES(?, ?, ?, ?, ?)`,
          [propertyId, file.path, image_url, index, is_primary],
          (errImg) => {
            if (errImg) {
              console.error("[v0] Error inserting image:", errImg)
              return res.status(500).json({ error: "Error al guardar imagen: " + errImg.message })
            }
            uploadedCount++
            if (uploadedCount === req.files.length) {
              res.json({
                id: propertyId,
                message: isApproved ? "Propiedad creada exitosamente" : "Propiedad enviada para aprobación",
              })
            }
          },
        )
      })
    },
  )
})

app.get("/user/properties/:user_id", (req, res) => {
  db.query(
    `SELECT p.*, p.rejected, p.rejection_reason,
    (SELECT image_url FROM property_images WHERE property_id = p.id AND is_primary = true LIMIT 1) as primary_image,
    (SELECT GROUP_CONCAT(image_url) FROM property_images WHERE property_id = p.id) as images
    FROM properties p WHERE p.user_id=? ORDER BY p.created_at DESC`,
    [req.params.user_id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err })
      res.json(result)
    },
  )
})

// LISTAR IMAGENES DE UNA PROPIEDAD (con IDs)
app.get("/user/properties/:id/images", (req, res) => {
  const propertyId = req.params.id;

  db.query(
    `SELECT id, image_url, display_order, is_primary
     FROM property_images
     WHERE property_id=?
     ORDER BY display_order ASC, id ASC`,
    [propertyId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message || err });
      res.json(rows);
    }
  );
});

// ELIMINAR UNA IMAGEN POR ID
app.delete("/images/:id", (req, res) => {
  const imageId = req.params.id;

  db.query(
    "SELECT id, image_path, property_id, is_primary FROM property_images WHERE id=?",
    [imageId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message || err });
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Imagen no encontrada" });

      const img = rows[0];

      db.query("DELETE FROM property_images WHERE id=?", [imageId], (err2) => {
        if (err2) return res.status(500).json({ error: err2.message || err2 });

        // borrar archivo físico (si existe)
        safeUnlink(img.image_path);

        // ✅ asegurar que quede 1 imagen primaria si todavía hay imágenes
        ensurePrimaryImage(img.property_id, (err3) => {
          if (err3) return res.status(500).json({ error: err3.message || err3 });
          return res.json({ message: "Imagen eliminada" });
        });
      });
    }
  );
});
/**
 * EDITAR (CORREGIDO)
 * Acepta archivos con nombre "new_images" (como tu Flutter) y también "images" por compatibilidad.
 * Soporta images_to_delete (ids CSV).
 * Actualiza todos los campos que envías desde Flutter.
 */
app.put(
  "/user/properties/:id",
  upload.fields([
    { name: "new_images", maxCount: 10 },
    { name: "images", maxCount: 10 },
  ]),
  (req, res) => {
    const propertyId = req.params.id

    const {
      title,
      description,
      price,
      currency,
      address,
      city,
      latitude,
      longitude,
      bedrooms,
      bathrooms,
      area,
      land_area,
      property_type,
      transaction_type,
      contact_phone,
      images_to_delete,
    } = req.body

    const deleteIds = parseCsvIds(images_to_delete)

    // 1) Actualiza la propiedad (y la manda a re-aprobación)
    db.query(
      `UPDATE properties SET 
        title=?, 
        description=?, 
        price=?, 
        currency=?, 
        address=?, 
        city=?,
        latitude=?,
        longitude=?,
        bedrooms=?,
        bathrooms=?,
        area=?,
        land_area=?,
        property_type=?,
        transaction_type=?,
        contact_phone=?,
        rejected=false, 
        rejection_reason=NULL, 
        approved=false
      WHERE id=?`,
      [
        title,
        description,
        price,
        currency || "BS",
        address,
        city || null,
        latitude || null,
        longitude || null,
        bedrooms || 0,
        bathrooms || 0,
        area || 0,
        land_area || 0,
        property_type || "casa",
        transaction_type || "venta",
        contact_phone || null,
        propertyId,
      ],
      (err) => {
        if (err) return res.status(500).json({ error: err.message || err })

        // 2) Borra imágenes seleccionadas (si vinieron ids)
        const doDelete = (cb) => {
          if (!deleteIds.length) return cb()

          // primero obtiene paths para borrar archivos físicos
          db.query(
            `SELECT id, image_path FROM property_images WHERE property_id=? AND id IN (${deleteIds.map(() => "?").join(",")})`,
            [propertyId, ...deleteIds],
            (errSel, rows) => {
              if (errSel) return res.status(500).json({ error: errSel.message || errSel })

              // borra en BD
              db.query(
                `DELETE FROM property_images WHERE property_id=? AND id IN (${deleteIds.map(() => "?").join(",")})`,
                [propertyId, ...deleteIds],
                (errDel) => {
                  if (errDel) return res.status(500).json({ error: errDel.message || errDel })

                  // borra archivos
                  rows.forEach((r) => safeUnlink(r.image_path))
                  cb()
                },
              )
            },
          )
        }

        // 3) Inserta imágenes nuevas (si llegaron)
        const doInsertNew = () => {
          const files = []
          if (req.files && req.files.new_images) files.push(...req.files.new_images)
          if (req.files && req.files.images) files.push(...req.files.images)

          if (!files.length) {
            return ensurePrimaryImage(propertyId, () => {
              return res.json({ message: "Propiedad actualizada y enviada para re-aprobación" })
            })
          }


          // busca el display_order actual máximo
          db.query(
            "SELECT COALESCE(MAX(display_order), -1) as maxOrder FROM property_images WHERE property_id=?",
            [propertyId],
            (errMax, maxRows) => {
              if (errMax) return res.status(500).json({ error: errMax.message || errMax })

              const startOrder = (maxRows?.[0]?.maxOrder ?? -1) + 1

              // ¿hay imagen primaria actualmente?
              db.query(
                "SELECT COUNT(*) as c FROM property_images WHERE property_id=? AND is_primary=true",
                [propertyId],
                (errPrim, primRows) => {
                  if (errPrim) return res.status(500).json({ error: errPrim.message || errPrim })

                  let hasPrimary = (primRows?.[0]?.c ?? 0) > 0

                  let uploadedCount = 0
                  files.forEach((file, index) => {
                    const image_url = getFileUrl(file.filename, req);
                    const order = startOrder + index

                    const is_primary = !hasPrimary && index === 0 ? true : false
                    if (is_primary) hasPrimary = true

                    db.query(
                      `INSERT INTO property_images(property_id, image_path, image_url, display_order, is_primary)
                       VALUES(?, ?, ?, ?, ?)`,
                      [propertyId, file.path, image_url, order, is_primary],
                      (errIns) => {
                        if (errIns) return res.status(500).json({ error: errIns.message || errIns })
                        uploadedCount++
                        if (uploadedCount === files.length) {
                          return ensurePrimaryImage(propertyId, () => {
                            return res.json({ message: "Propiedad actualizada y enviada para re-aprobación" })
                          })
                        }
                      },
                    )
                  })
                },
              )
            },
          )
        }

        doDelete(doInsertNew)
      },
    )
  },
)

app.put("/user/properties/:id/sold", (req, res) => {
  db.query("UPDATE properties SET sold = true, approved = false WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err })
    res.json({ message: "Propiedad marcada como vendida" })
  })
})

app.delete("/user/properties/:id", (req, res) => {
  const propertyId = req.params.id
  const { user_id } = req.body

  db.query("SELECT user_id FROM properties WHERE id = ?", [propertyId], (err, result) => {
    if (err) return res.status(500).json({ error: err })
    if (result.length === 0) return res.status(404).json({ error: "Propiedad no encontrada" })

    if (result[0].user_id !== user_id) {
      return res.status(403).json({ error: "No tienes permiso para eliminar esta propiedad" })
    }

    db.query("SELECT image_path FROM property_images WHERE property_id = ?", [propertyId], (errSel, rows) => {
      if (errSel) return res.status(500).json({ error: errSel })

      db.query("DELETE FROM property_images WHERE property_id = ?", [propertyId], (errDelImgs) => {
        if (errDelImgs) return res.status(500).json({ error: errDelImgs })

        // borrar archivos
        rows.forEach((r) => safeUnlink(r.image_path))

        db.query("DELETE FROM properties WHERE id = ?", [propertyId], (errDelProp) => {
          if (errDelProp) return res.status(500).json({ error: errDelProp })
          res.json({ message: "Propiedad eliminada" })
        })
      })
    })
  })
})

app.put("/user/properties/:id/price", (req, res) => {
  const { price, user_id } = req.body
  const propertyId = req.params.id

  db.query("SELECT user_id, approved FROM properties WHERE id = ?", [propertyId], (err, result) => {
    if (err) return res.status(500).json({ error: err.message })
    if (result.length === 0) return res.status(404).json({ error: "Propiedad no encontrada" })
    if (result[0].user_id !== user_id) {
      return res.status(403).json({ error: "No tienes permiso para modificar esta propiedad" })
    }
    if (!result[0].approved) {
      return res.status(400).json({ error: "Solo puedes cambiar el precio de propiedades aprobadas" })
    }

    db.query("UPDATE properties SET price = ? WHERE id = ?", [price, propertyId], (err2) => {
      if (err2) return res.status(500).json({ error: err2.message })
      res.json({ message: "Precio actualizado" })
    })
  })
})

// ==========================
// 👤 PERFIL USUARIO
// ==========================
app.get("/user/:id", (req, res) => {
  db.query("SELECT id, email, name, phone, role FROM users WHERE id=?", [req.params.id], (err, result) => {
    if (err) return res.status(500).json({ error: err })
    if (result.length === 0) return res.status(404).json({ error: "Usuario no encontrado" })
    res.json(result[0])
  })
})

app.put("/user/:id", (req, res) => {
  const { name, phone, email } = req.body
  db.query("UPDATE users SET name=?, phone=?, email=? WHERE id=?", [name, phone, email, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err })
    res.json({ message: "Perfil actualizado" })
  })
})

// ==========================
// 🏛️ INFORMACIÓN CREATECTO
// ==========================
// ==========================
// CREATECTO - RUTAS PÚBLICAS
// ==========================
app.get("/admin/createcto/info", (req, res) => {
  const sql = `SELECT * FROM createcto_info LIMIT 1`
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: err.message })
    
    if (results.length === 0) {
      return res.json({ 
        id: 1, 
        about_text: '', 
        QuienesSomos: '',
        mission: '',
        vision: '',
        logo_url: null,
        pdf1_nit_url: null,
        pdf2_fundaEmpresa_url: null,
        pdf3_Licencia_url: null,
        pdf4_RLegal_url: null
      })
    }
    
    const info = results[0];
    
    // REGENERA TODAS LAS URLs de PDFs y logo
    const fieldsToRegenerate = [
      'logo_url', 
      'pdf1_nit_url', 
      'pdf2_fundaEmpresa_url', 
      'pdf3_Licencia_url', 
      'pdf4_RLegal_url'
    ];
    
    fieldsToRegenerate.forEach(field => {
      if (info[field]) {
        info[field] = regenerateImageUrl(info[field], req);
      }
    });
    
    // Get social media
    const socialSql = 'SELECT * FROM createcto_social_media ORDER BY display_order'
    db.query(socialSql, (err, socials) => {
      if (err) return res.status(500).json({ error: err.message })
      res.json({ ...info, social_media: socials || [] })
    })
  })
})

// GET Createcto Projects (public) - CORREGIDO CON CONTEO
app.get("/createcto/projects", (req, res) => {
  const sql = `
    SELECT 
      p.*,
      (SELECT image_url FROM createcto_project_images WHERE project_id = p.id AND is_primary = 1 LIMIT 1) as primary_image,
      (SELECT COUNT(*) FROM createcto_floors WHERE project_id = p.id) as total_floors,
      (SELECT COUNT(*) FROM createcto_departments WHERE floor_id IN (SELECT id FROM createcto_floors WHERE project_id = p.id)) as total_departments
    FROM createcto_projects p
    ORDER BY p.display_order ASC
  `;

  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// GET Single Createcto Project (public) - CORREGIDO
app.get("/createcto/projects/:id", (req, res) => {
  const projectId = req.params.id;

  const sql = `
    SELECT * FROM createcto_projects WHERE id = ?
  `;

  db.query(sql, [projectId], (err, projects) => {
    if (err) return res.status(500).json({ error: err.message });
    if (projects.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const project = projects[0];

    // Get images
    const imgSql = 'SELECT * FROM createcto_project_images WHERE project_id = ? ORDER BY display_order';
    db.query(imgSql, [projectId], (err, images) => {
      if (err) return res.status(500).json({ error: err.message });

      // Get floors with departments
      const floorSql = `
        SELECT f.*, 
          GROUP_CONCAT(CONCAT(d.id, '|', d.department_number, '|', d.area_sqm, '|', d.availability_status) SEPARATOR '::') as departments_data
        FROM createcto_floors f
        LEFT JOIN createcto_departments d ON f.id = d.floor_id
        WHERE f.project_id = ?
        GROUP BY f.id
        ORDER BY f.floor_number
      `;
      db.query(floorSql, [projectId], (err, floors) => {
        if (err) return res.status(500).json({ error: err.message });

        const floorsData = floors.map(f => {
          const departments = f.departments_data
            ? f.departments_data.split('::').map(d => {
              const [id, dept_num, sqm, status] = d.split('|');
              return {
                id: parseInt(id),
                department_number: parseInt(dept_num),
                area_sqm: parseFloat(sqm),
                availability_status: status
              };
            })
            : [];
          return { ...f, departments };
        });

        res.json({ ...project, images, floors: floorsData });
      });
    });
  });
});
/////
////
///

// GET Single Createcto Project (admin) - with all details
app.get("/admin/createcto/projects/:id", (req, res) => {
  getProjectDetails(req.params.id, res);
});

// GET Single Createcto Project (public) - with all details
app.get("/createcto/projects/:id", (req, res) => {
  getProjectDetails(req.params.id, res);
});

// Helper function to get project details
function getProjectDetails(projectId, res) {
  const sql = `SELECT * FROM createcto_projects WHERE id = ?`;

  db.query(sql, [projectId], (err, projects) => {
    if (err) return res.status(500).json({ error: err.message });
    if (projects.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const project = projects[0];

    // Get images
    const imgSql = 'SELECT * FROM createcto_project_images WHERE project_id = ? ORDER BY display_order';
    db.query(imgSql, [projectId], (err, images) => {
      if (err) return res.status(500).json({ error: err.message });

      // Get floors with departments - using correct column names
      const floorSql = `SELECT * FROM createcto_floors WHERE project_id = ? ORDER BY floor_number`;
      db.query(floorSql, [projectId], (err, floors) => {
        if (err) return res.status(500).json({ error: err.message });

        if (floors.length === 0) {
          return res.json({ ...project, images, floors: [] });
        }

        // Get departments for each floor
        const floorIds = floors.map(f => f.id);
        const deptSql = `SELECT * FROM createcto_departments WHERE floor_id IN (?) ORDER BY department_number`;
        db.query(deptSql, [floorIds], (err, departments) => {
          if (err) return res.status(500).json({ error: err.message });

          const floorsData = floors.map(f => {
            const floorDepts = departments.filter(d => d.floor_id === f.id);
            return { ...f, departments: floorDepts };
          });

          res.json({ ...project, images, floors: floorsData });
        });
      });
    });
  });
}

// GET Social Media
// GET Createcto Info (public)
app.get("/createcto/info", (req, res) => {
  const sql = `SELECT * FROM createcto_info LIMIT 1`
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: err.message })
    
    if (results.length === 0) {
      return res.json({ 
        id: 1, 
        about_text: '', 
        QuienesSomos: '',
        mission: '',
        vision: '',
        logo_url: null,
        pdf1_nit_url: null,
        pdf2_fundaEmpresa_url: null,
        pdf3_Licencia_url: null,
        pdf4_RLegal_url: null
      })
    }
    
    res.json(results[0])
  })
})

// GET Social Media (public)
app.get("/createcto/social-media", (req, res) => {
  db.query("SELECT * FROM createcto_social_media WHERE is_visible = 1 ORDER BY display_order", (err, result) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json(result)
  })
})

// GET Floors for a project
app.get("/createcto/projects/:id/floors", (req, res) => {
  db.query(
    "SELECT * FROM createcto_floors WHERE project_id = ? ORDER BY floor_number",
    [req.params.id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message })
      res.json(result)
    }
  )
})

// GET Departments for a floor
app.get("/createcto/floors/:id/departments", (req, res) => {
  db.query(
    "SELECT * FROM createcto_departments WHERE floor_id = ? ORDER BY department_number",
    [req.params.id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message })
      res.json(result)
    }
  )
})

// UPDATE Createcto Info
app.put("/admin/createcto/info", upload.single("logo"), (req, res) => {
  const { about_text, QuienesSomos, mission, vision } = req.body

  db.query("SELECT id, logo_path FROM createcto_info LIMIT 1", (err, results) => {
    if (err) return res.status(500).json({ error: err.message })

    let updates = []
    let params = []

    if (about_text !== undefined && about_text !== null) {
      updates.push("about_text = ?")
      params.push(about_text)
    }
    if (QuienesSomos !== undefined && QuienesSomos !== null) {
      updates.push("QuienesSomos = ?")
      params.push(QuienesSomos)
    }
    if (mission !== undefined && mission !== null) {
      updates.push("mission = ?")
      params.push(mission)
    }
    if (vision !== undefined && vision !== null) {
      updates.push("vision = ?")
      params.push(vision)
    }

    if (req.file) {
      // Usa getFileUrl para asegurar URL correcta
      const logoUrl = getFileUrl(req.file.filename, req);
      updates.push("logo_url = ?", "logo_path = ?")
      params.push(logoUrl, req.file.path)

      // Delete old logo
      if (results.length > 0 && results[0].logo_path) {
        safeUnlink(results[0].logo_path)
      }
    }

    if (updates.length === 0) {
      return res.json({ message: "Información actualizada correctamente" })
    }

    if (results.length === 0) {
      // Insert new record
      const insertQuery = `INSERT INTO createcto_info (${updates.map(u => u.split(' = ')[0]).join(', ')}) VALUES (${params.map(() => '?').join(', ')})`
      db.query(insertQuery, params, (err) => {
        if (err) return res.status(500).json({ error: err.message })
        res.json({ message: "Información creada correctamente" })
      })
    } else {
      // Update existing
      const updateQuery = `UPDATE createcto_info SET ${updates.join(', ')} WHERE id = ?`
      params.push(results[0].id)
      db.query(updateQuery, params, (err) => {
        if (err) return res.status(500).json({ error: err.message })
        res.json({ message: "Información actualizada correctamente" })
      })
    }
  })
})

// ADD/UPDATE PDF documents to Createcto Info
app.post("/admin/createcto/pdfs", upload.single("pdf"), (req, res) => {
  console.log("[v0] PDF upload started:", { pdf_type: req.body.pdf_type, file: req.file?.filename })
  
  const { pdf_type } = req.body
  if (!req.file || !pdf_type) {
    console.log("[v0] PDF upload error: missing file or pdf_type")
    return res.status(400).json({ error: "PDF y tipo de documento requeridos" })
  }
  
  // Asegúrate que getFileUrl se llame correctamente para PDFs
  const pdfUrl = getFileUrl(req.file.filename, req);
  const pdfPath = req.file.path
  
  console.log("[v0] PDF file info:", { pdfUrl, pdfPath, filename: req.file.filename })
  
  console.log("[v0] PDF file info:", { pdfUrl, pdfPath, filename: req.file.filename })

  // Map pdf_type to database columns
  const pdfColumns = {
    'nit': { urlCol: 'pdf1_nit_url', pathCol: 'pdf1_nit_path' },
    'fundacion': { urlCol: 'pdf2_fundaEmpresa_url', pathCol: 'pdf2_fundaEmpresa_path' },
    'licencia': { urlCol: 'pdf3_Licencia_url', pathCol: 'pdf3_Licencia_path' },
    'legal': { urlCol: 'pdf4_RLegal_url', pathCol: 'pdf4_RLegal_path' }
  }

  if (!pdfColumns[pdf_type]) {
    console.log("[v0] PDF upload error: invalid pdf_type:", pdf_type)
    safeUnlink(pdfPath)
    return res.status(400).json({ error: "Tipo de PDF inválido: " + pdf_type })
  }

  const cols = pdfColumns[pdf_type]
  console.log("[v0] Using columns:", cols)

  // Get existing info to delete old file and get ID
  db.query("SELECT id FROM createcto_info LIMIT 1", (err, results) => {
    if (err) {
      console.log("[v0] Error getting createcto_info:", err)
      return res.status(500).json({ error: err.message })
    }

    if (results.length === 0) {
      console.log("[v0] Creating new createcto_info record")
      // Insert new record
      const insertQuery = `INSERT INTO createcto_info (${cols.urlCol}, ${cols.pathCol}) VALUES (?, ?)`
      db.query(insertQuery, [pdfUrl, pdfPath], (err, result) => {
        if (err) {
          console.log("[v0] Insert error:", err)
          safeUnlink(pdfPath)
          return res.status(500).json({ error: err.message })
        }
        console.log("[v0] PDF inserted successfully")
        res.json({ id: result.insertId, message: "PDF subido correctamente" })
      })
    } else {
      const recordId = results[0].id
      console.log("[v0] Updating existing createcto_info record, id:", recordId)
      
      // Delete old file first
      const checkOldQuery = `SELECT ${cols.pathCol} FROM createcto_info WHERE id = ?`
      db.query(checkOldQuery, [recordId], (err, oldResults) => {
        if (err) {
          console.log("[v0] Error checking old file:", err)
          return res.status(500).json({ error: err.message })
        }
        
        if (oldResults.length > 0 && oldResults[0][cols.pathCol]) {
          console.log("[v0] Deleting old file:", oldResults[0][cols.pathCol])
          safeUnlink(oldResults[0][cols.pathCol])
        }
        
        // Update with new file
        const updateQuery = `UPDATE createcto_info SET ${cols.urlCol} = ?, ${cols.pathCol} = ? WHERE id = ?`
        db.query(updateQuery, [pdfUrl, pdfPath, recordId], (err) => {
          if (err) {
            console.log("[v0] Update error:", err)
            safeUnlink(pdfPath)
            return res.status(500).json({ error: err.message })
          }
          console.log("[v0] PDF updated successfully")
          res.json({ id: recordId, message: "PDF actualizado correctamente" })
        })
      })
    }
  })
})

// CREATE Floor
app.post("/admin/createcto/projects/:id/floors", (req, res) => {
  const { floor_number, total_departments, square_meters, characteristics } = req.body
  db.query(
    `INSERT INTO createcto_floors(project_id, floor_number, total_departments, square_meters, characteristics)
    VALUES(?, ?, ?, ?, ?)`,
    [req.params.id, floor_number, total_departments || 0, square_meters || null, characteristics || null],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message })
      res.json({ id: result.insertId, message: "Piso creado" })
    }
  )
})

// UPDATE Floor
app.put("/admin/createcto/floors/:id", (req, res) => {
  const { floor_number, total_departments, square_meters, characteristics } = req.body
  db.query(
    `UPDATE createcto_floors SET floor_number = ?, total_departments = ?, square_meters = ?, characteristics = ? WHERE id = ?`,
    [floor_number, total_departments || 0, square_meters || null, characteristics || null, req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message })
      res.json({ message: "Piso actualizado" })
    }
  )
})

// DELETE Floor
app.delete("/admin/createcto/floors/:id", (req, res) => {
  db.query("DELETE FROM createcto_departments WHERE floor_id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message })
    db.query("DELETE FROM createcto_floors WHERE id = ?", [req.params.id], (err2) => {
      if (err2) return res.status(500).json({ error: err2.message })
      res.json({ message: "Piso eliminado" })
    })
  })
})

// CREATE Department
app.post("/admin/createcto/floors/:id/departments", (req, res) => {
  const { department_number, size_sqm, bedrooms, bathrooms, has_balcony, has_parking, has_storage, characteristics, price, status } = req.body
  db.query(
    `INSERT INTO createcto_departments(floor_id, department_number, size_sqm, bedrooms, bathrooms, has_balcony, has_parking, has_storage, characteristics, price, status)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.params.id, department_number, size_sqm || null, bedrooms || 1, bathrooms || 1,
    has_balcony ? 1 : 0, has_parking ? 1 : 0, has_storage ? 1 : 0,
    characteristics || null, price || null, status || 'available'],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message })
      res.json({ id: result.insertId, message: "Departamento creado" })
    }
  )
})

// UPDATE Department
app.put("/admin/createcto/departments/:id", (req, res) => {
  const { department_number, size_sqm, bedrooms, bathrooms, has_balcony, has_parking, has_storage, characteristics, price, status } = req.body
  db.query(
    `UPDATE createcto_departments SET 
      department_number = COALESCE(?, department_number),
      size_sqm = COALESCE(?, size_sqm),
      bedrooms = COALESCE(?, bedrooms),
      bathrooms = COALESCE(?, bathrooms),
      has_balcony = COALESCE(?, has_balcony),
      has_parking = COALESCE(?, has_parking),
      has_storage = COALESCE(?, has_storage),
      characteristics = COALESCE(?, characteristics),
      price = COALESCE(?, price),
      status = COALESCE(?, status)
    WHERE id = ?`,
    [department_number, size_sqm, bedrooms, bathrooms,
      has_balcony !== undefined ? (has_balcony ? 1 : 0) : null,
      has_parking !== undefined ? (has_parking ? 1 : 0) : null,
      has_storage !== undefined ? (has_storage ? 1 : 0) : null,
      characteristics, price, status, req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message })
      res.json({ message: "Departamento actualizado" })
    }
  )
})

// DELETE Department
app.delete("/admin/createcto/departments/:id", (req, res) => {
  db.query("DELETE FROM createcto_departments WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json({ message: "Departamento eliminado" })
  })
})

// Social Media
app.post("/admin/createcto/social-media", (req, res) => {
  const { platform, url, visible } = req.body
  
  if (!platform || !url) {
    return res.status(400).json({ error: "Platform y URL son requeridos" })
  }
  
  db.query(
    `INSERT INTO createcto_social_media(platform, url, is_visible) VALUES(?, ?, ?)`,
    [platform, url, visible !== false ? 1 : 0],
    (err, result) => {
      if (err) {
        console.error("[v0] Error inserting social media:", err)
        return res.status(500).json({ error: err.message })
      }
      res.json({ id: result.insertId, message: "Red social agregada" })
    },
  )
})

app.put("/admin/createcto/social-media/:id", (req, res) => {
  const { url, visible } = req.body
  db.query(
    `UPDATE createcto_social_media SET url=?, is_visible=? WHERE id=?`,
    [url, visible !== false ? 1 : 0, req.params.id],
    (err) => {
      if (err) {
        console.error("[v0] Error updating social media:", err)
        return res.status(500).json({ error: err.message })
      }
      res.json({ message: "Red social actualizada" })
    },
  )
})

app.delete("/admin/createcto/social-media/:id", (req, res) => {
  db.query("DELETE FROM createcto_social_media WHERE id=?", [req.params.id], (err) => {
    if (err) {
      console.error("[v0] Error deleting social media:", err)
      return res.status(500).json({ error: err.message })
    }
    res.json({ message: "Red social eliminada" })
  })
})

// ==========================
// 🔧 ADMIN
// ==========================
app.get("/admin/dashboard", (req, res) => {
  const queries = [
    "SELECT COUNT(*) as total FROM properties WHERE approved = true",
    "SELECT COUNT(*) as pending FROM properties WHERE approved=false AND rejected=false",
    "SELECT COUNT(*) as users FROM users WHERE role != 'admin'",
    "SELECT COALESCE(SUM(CAST(payment_amount AS DECIMAL(10,2))), 0) as bannerRevenue FROM banners",
    "SELECT COALESCE(SUM(CAST(featured_amount AS DECIMAL(10,2))), 0) as featuredRevenue FROM properties WHERE is_featured = true",
    "SELECT COUNT(*) as casas FROM properties WHERE property_type = 'casa' AND approved = true",
    "SELECT COUNT(*) as terrenos FROM properties WHERE property_type = 'terreno' AND approved = true",
    "SELECT COUNT(*) as locales FROM properties WHERE property_type = 'local' AND approved = true",
  ]

  let completed = 0
  const results = {}

  queries.forEach((query) => {
    db.query(query, (err, result) => {
      const key = Object.keys(result[0])[0]
      results[key] = err ? 0 : Number.parseFloat(result[0][key]) || 0
      completed++

      if (completed === queries.length) {
        res.json({
          totalProperties: results.total,
          pendingApproval: results.pending,
          totalUsers: results.users,
          bannerRevenue: results.bannerRevenue,
          featuredRevenue: results.featuredRevenue,
          casas: results.casas,
          terrenos: results.terrenos,
          locales: results.locales,
        })
      }
    })
  })
})

app.get("/admin/pending-properties", (req, res) => {
  db.query(
    `SELECT p.*,
    (SELECT image_url FROM property_images WHERE property_id = p.id AND is_primary = true LIMIT 1) as primary_image
    FROM properties p WHERE p.approved=false AND (p.rejected=false OR p.rejected IS NULL) ORDER BY p.created_at DESC`,
    (err, result) => {
      if (err) return res.status(500).json({ error: err })
      res.json(result)
    },
  )
})

app.put("/admin/properties/:id/approve", (req, res) => {
  db.query("UPDATE properties SET approved=true, rejected=false, rejection_reason=NULL WHERE id=?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err })
    res.json({ message: "Aprobado" })
  })
})

app.put("/admin/properties/:id/reject", (req, res) => {
  const { rejection_reason } = req.body
  db.query(
    "UPDATE properties SET rejected=true, approved=false, rejection_reason=? WHERE id=?",
    [rejection_reason || "Sin motivo especificado", req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: err })
      res.json({ message: "Rechazado" })
    },
  )
})

app.delete("/admin/properties/:id", (req, res) => {
  db.query("SELECT image_path FROM property_images WHERE property_id=?", [req.params.id], (errSel, rows) => {
    if (errSel) return res.status(500).json({ error: errSel })

    db.query("DELETE FROM property_images WHERE property_id=?", [req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err })

      rows.forEach((r) => safeUnlink(r.image_path))

      db.query("DELETE FROM properties WHERE id=?", [req.params.id], (err2) => {
        if (err2) return res.status(500).json({ error: err2 })
        res.json({ message: "Propiedad eliminada" })
      })
    })
  })
})



// REEMPLAZA LOS DOS ENDPOINTS ANTERIORES CON ESTE:
app.put("/admin/properties/:id/toggle-feature", (req, res) => {
  const propertyId = req.params.id;
  const { featured, amount, start_date, end_date } = req.body;

  // Primero verifica el estado actual
  db.query("SELECT is_featured FROM properties WHERE id = ?", [propertyId], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.length === 0) return res.status(404).json({ error: "Propiedad no encontrada" });

    const isCurrentlyFeatured = result[0].is_featured;
    const shouldFeature = featured !== undefined ? featured : !isCurrentlyFeatured;

    if (shouldFeature) {
      // Destacar la propiedad
      const featuredAmount = Number.parseFloat(amount) || 0;
      db.query(
        `UPDATE properties SET is_featured = true, featured_amount = ?, featured_start = ?, featured_end = ? WHERE id = ?`,
        [featuredAmount, start_date, end_date, propertyId],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ 
            message: "Propiedad destacada exitosamente",
            is_featured: true 
          });
        },
      );
    } else {
      // Quitar destacado
      db.query(
        `UPDATE properties SET is_featured = false, featured_amount = 0, featured_start = NULL, featured_end = NULL WHERE id = ?`,
        [propertyId],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ 
            message: "Destacado removido exitosamente",
            is_featured: false 
          });
        },
      );
    }
  });
});

app.get("/admin/users", (req, res) => {
  db.query('SELECT id, name, email, phone, role, created_at FROM users WHERE role != "admin"', (err, result) => {
    if (err) return res.status(500).json({ error: err })
    res.json(result)
  })
})

app.delete("/admin/users/:id", (req, res) => {
  db.query("DELETE FROM users WHERE id=?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err })
    res.json({ message: "Usuario eliminado" })
  })
})

app.get("/admin/properties", (req, res) => {
  db.query(
    `SELECT p.*,
    (SELECT image_url FROM property_images WHERE property_id = p.id AND is_primary = true LIMIT 1) as primary_image
    FROM properties p
    WHERE p.approved = true
    ORDER BY p.is_featured DESC, p.created_at DESC`,
    (err, result) => {
      if (err) return res.status(500).json({ error: err })
      res.json(result)
    },
  )
})

// ==========================
// 🏗️ PROYECTOS DE INVERSIÓN
// ==========================

// OBTENER TODOS LOS PROYECTOS (público/guest)
app.get("/projects", (req, res) => {
  db.query(
    `SELECT p.*, 
    (SELECT image_url FROM project_images WHERE project_id = p.id AND is_primary = true LIMIT 1) as primary_image
    FROM projects p 
    WHERE p.approved = true 
    ORDER BY p.created_at DESC`,
    (err, result) => {
      if (err) return res.status(500).json({ error: err })
      res.json(result)
    }
  )
})

// OBTENER DETALLES DE UN PROYECTO
app.get("/projects/:id", (req, res) => {
  db.query(
    `SELECT p.*, u.name as creator_name, u.phone as creator_phone,
    (SELECT GROUP_CONCAT(image_url) FROM project_images WHERE project_id = p.id) as images
    FROM projects p 
    LEFT JOIN users u ON p.user_id = u.id
    WHERE p.id = ?`,
    [req.params.id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err })
      if (result.length === 0) return res.status(404).json({ error: "Proyecto no encontrado" })
      res.json(result[0])
    }
  )
})

// OBTENER PISOS DE UN PROYECTO
app.get("/projects/:project_id/floors", (req, res) => {
  db.query(
    `SELECT pf.*, 
    (SELECT COUNT(*) FROM project_units WHERE floor_id = pf.id) as total_units,
    (SELECT COUNT(*) FROM project_units WHERE floor_id = pf.id AND is_available = true) as available_units
    FROM project_floors pf 
    WHERE pf.project_id = ? 
    ORDER BY pf.floor_number ASC`,
    [req.params.project_id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err })
      res.json(result)
    }
  )
})

// OBTENER UNIDADES/DEPARTAMENTOS DE UN PISO
app.get("/floors/:floor_id/units", (req, res) => {
  db.query(
    `SELECT * FROM project_units 
    WHERE floor_id = ? 
    ORDER BY unit_number ASC`,
    [req.params.floor_id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err })
      res.json(result)
    }
  )
})

// CREAR PROYECTO (admin)
// Reemplazar el endpoint existente
app.get("/admin/projects", (req, res) => {
  db.query(
    `SELECT i.*, 
    (SELECT image_url FROM investment_images WHERE investment_id = i.id AND is_primary = true LIMIT 1) as primary_image
    FROM investments i 
    ORDER BY i.created_at DESC`,
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(result);
    }
  );
});

app.post("/admin/projects", upload.array("images", 15), (req, res) => {
  const {
    name,
    description,
    location,
    project_type,
    min_investment,
    max_investment,
    duration,
    details,
    phases // JSON string
  } = req.body;

  // Insertar en investments
  db.query(
    `INSERT INTO investments (
      name, description, location, project_type, 
      min_investment, max_investment, total_funding_goal,
      expected_return_percentage, investment_period_months, currency
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      description || null,
      location || null,
      project_type || "Residencial",
      parseFloat(min_investment) || 0,
      parseFloat(max_investment) || 0,
      parseFloat(max_investment) || 0, // total_funding_goal
      10.0, // expected_return_percentage (debería venir del formulario)
      parseInt(duration) || 0,
      "USD"
    ],
    (err, result) => {
      if (err) {
        // Limpiar archivos
        if (req.files) {
          req.files.forEach(f => fs.unlinkSync(f.path));
        }
        return res.status(500).json({ error: err.message });
      }

      const investmentId = result.insertId;

      // Insertar imágenes
      let imageCount = 0;
      if (req.files && req.files.length > 0) {
        req.files.forEach((file, index) => {
          const imageUrl = getFileUrl(file.filename, req);
          db.query(
            `INSERT INTO investment_images (investment_id, image_url, image_path, display_order, is_primary)
             VALUES (?, ?, ?, ?, ?)`,
            [investmentId, imageUrl, file.path, index, index === 0 ? 1 : 0],
            () => {
              imageCount++;
              if (imageCount === req.files.length) {
                // Insertar fases si existen
                if (phases) {
                  try {
                    const phasesData = JSON.parse(phases);
                    if (Array.isArray(phasesData)) {
                      let phaseCount = 0;
                      phasesData.forEach((phase, index) => {
                        db.query(
                          `INSERT INTO investment_phases (investment_id, phase_number, name, planned_percentage)
                           VALUES (?, ?, ?, ?)`,
                          [
                            investmentId,
                            index + 1,
                            phase['name'] || `Fase ${index + 1}`,
                            parseFloat(phase['percent']) || 0
                          ],
                          () => {
                            phaseCount++;
                            if (phaseCount === phasesData.length) {
                              res.json({ 
                                id: investmentId, 
                                message: "Proyecto creado exitosamente" 
                              });
                            }
                          }
                        );
                      });
                    } else {
                      res.json({ 
                        id: investmentId, 
                        message: "Proyecto creado exitosamente" 
                      });
                    }
                  } catch (e) {
                    console.error("Error parsing phases:", e);
                    res.json({ 
                      id: investmentId, 
                      message: "Proyecto creado exitosamente (sin fases)" 
                    });
                  }
                } else {
                  res.json({ 
                    id: investmentId, 
                    message: "Proyecto creado exitosamente" 
                  });
                }
              }
            }
          );
        });
      } else {
        res.json({ 
          id: investmentId, 
          message: "Proyecto creado exitosamente (sin imágenes)" 
        });
      }
    }
  );
});

// EDITAR PROYECTO (admin)
app.put("/admin/projects/:id", upload.array("new_images", 15), (req, res) => {
  const projectId = req.params.id
  const {
    name,
    description,
    location,
    latitude,
    longitude,
    total_area,
    min_investment,
    expected_return,
    duration_months,
    project_type,
    contact_whatsapp,
    pdf_url,
    images_to_delete
  } = req.body

  db.query(
    `UPDATE projects SET name=?, description=?, location=?, latitude=?, longitude=?, 
    total_area=?, min_investment=?, expected_return=?, duration_months=?, 
    project_type=?, contact_whatsapp=?, pdf_url=? WHERE id=?`,
    [name, description, location, latitude, longitude, total_area, min_investment,
      expected_return, duration_months, project_type, contact_whatsapp, pdf_url, projectId],
    (err) => {
      if (err) return res.status(500).json({ error: err })

      // Eliminar imágenes si se especifican
      if (images_to_delete) {
        const idsToDelete = parseCsvIds(images_to_delete)
        if (idsToDelete.length > 0) {
          db.query(
            `SELECT image_path FROM project_images WHERE id IN (${idsToDelete.join(',')})`,
            (err, rows) => {
              if (!err && rows) {
                rows.forEach(r => safeUnlink(r.image_path))
              }
              db.query(
                `DELETE FROM project_images WHERE id IN (${idsToDelete.join(',')})`,
                () => { }
              )
            }
          )
        }
      }

      // Agregar nuevas imágenes si se suben
      if (req.files && req.files.length > 0) {
        let uploadedCount = 0
        req.files.forEach((file) => {
          const image_url = getFileUrl(file.filename, req);
          db.query(
            `INSERT INTO project_images(project_id, image_path, image_url, is_primary)
             VALUES(?, ?, ?, false)`,
            [projectId, file.path, image_url],
            () => {
              uploadedCount++
              if (uploadedCount === req.files.length) {
                res.json({ message: "Proyecto actualizado exitosamente" })
              }
            }
          )
        })
      } else {
        res.json({ message: "Proyecto actualizado exitosamente" })
      }
    }
  )
})

// CREAR PISOS EN UN PROYECTO
app.post("/admin/projects/:project_id/floors", (req, res) => {
  const { floor_number, total_units } = req.body
  const projectId = req.params.project_id

  db.query(
    `INSERT INTO project_floors(project_id, floor_number, total_units)
    VALUES(?, ?, ?)`,
    [projectId, floor_number, total_units],
    (err, result) => {
      if (err) return res.status(500).json({ error: err })
      res.json({ id: result.insertId, message: "Piso creado" })
    }
  )
})

// CREAR UNIDADES EN UN PISO
app.post("/admin/floors/:floor_id/units", (req, res) => {
  const { unit_number, size_sqm, price, is_available } = req.body
  const floorId = req.params.floor_id

  db.query(
    `INSERT INTO project_units(floor_id, unit_number, size_sqm, price, is_available)
    VALUES(?, ?, ?, ?, ?)`,
    [floorId, unit_number, size_sqm, price, is_available ? 1 : 0],
    (err, result) => {
      if (err) return res.status(500).json({ error: err })
      res.json({ id: result.insertId, message: "Unidad creada" })
    }
  )
})

// ACTUALIZAR DISPONIBILIDAD DE UNIDAD
app.put("/admin/units/:id", (req, res) => {
  const { is_available } = req.body
  db.query(
    `UPDATE project_units SET is_available = ? WHERE id = ?`,
    [is_available ? 1 : 0, req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: err })
      res.json({ message: "Disponibilidad actualizada" })
    }
  )
})

// FAVORITOS DE INVERSIONES
app.post("/project-favorites", (req, res) => {
  const { user_id, project_id } = req.body
  db.query(
    `INSERT INTO project_favorites(user_id, project_id) VALUES(?, ?) 
    ON DUPLICATE KEY UPDATE id=id`,
    [user_id, project_id],
    (err) => {
      if (err) return res.status(400).json({ error: "Ya en favoritos" })
      res.json({ message: "Agregado a favoritos" })
    }
  )
})

app.get("/project-favorites/:user_id", (req, res) => {
  db.query(
    `SELECT p.*,
    (SELECT image_url FROM project_images WHERE project_id = p.id AND is_primary = true LIMIT 1) as primary_image
    FROM projects p
    JOIN project_favorites pf ON p.id = pf.project_id
    WHERE pf.user_id = ?`,
    [req.params.user_id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err })
      res.json(result)
    }
  )
})

app.delete("/project-favorites/:user_id/:project_id", (req, res) => {
  db.query(
    `DELETE FROM project_favorites WHERE user_id=? AND project_id=?`,
    [req.params.user_id, req.params.project_id],
    (err) => {
      if (err) return res.status(500).json({ error: err })
      res.json({ message: "Eliminado de favoritos" })
    }
  )
})

// INVERSIONES DEL USUARIO (mis inversiones)
app.get("/user-investments/:user_id", (req, res) => {
  db.query(
    `SELECT p.*, pu.*, pi.invested_amount, pi.invested_date, pi.expected_return_amount
    FROM projects p
    JOIN project_investments pi ON p.id = pi.project_id
    JOIN project_units pu ON pi.unit_id = pu.id
    WHERE pi.user_id = ?
    ORDER BY pi.invested_date DESC`,
    [req.params.user_id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err })
      res.json(result)
    }
  )
})

// REGISTRAR INVERSIÓN EN UNIDAD
app.post("/admin/investments", (req, res) => {
  const { user_id, project_id, unit_id, invested_amount, expected_return_amount } = req.body

  db.query(
    `INSERT INTO project_investments(user_id, project_id, unit_id, invested_amount, expected_return_amount)
    VALUES(?, ?, ?, ?, ?)`,
    [user_id, project_id, unit_id, invested_amount, expected_return_amount],
    (err, result) => {
      if (err) return res.status(500).json({ error: err })

      // Marcar unidad como no disponible
      db.query(
        `UPDATE project_units SET is_available = false WHERE id = ?`,
        [unit_id],
        () => { }
      )

      res.json({ id: result.insertId, message: "Inversión registrada" })
    }
  )
})
// ==========================
// 🏢 CREATECTO - ADMIN CRUD PROYECTOS
// ==========================
app.post("/admin/createcto/projects", upload.fields([
  { name: "primary_image", maxCount: 1 },
  { name: "images", maxCount: 15 },
  { name: "pdf", maxCount: 1 }
]), (req, res) => {
  const { name, description, location, latitude, longitude, contact_whatsapp, display_order, floors } = req.body;

  if (!name) {
    if (req.files) {
      Object.values(req.files).flat().forEach(f => safeUnlink(f.path));
    }
    return res.status(400).json({ error: "El nombre es requerido" });
  }

  // VERIFICACIÓN: mostrar qué archivos llegaron
  console.log('[v0] Files received:', req.files);
  
  let pdfUrl = null, pdfPath = null;
  let primaryImageUrl = null, primaryImagePath = null;
  let hasPrimaryImage = false;
  
  // 1. Procesar PDF
  if (req.files?.pdf?.[0]) {
    pdfUrl = getFileUrl(req.files.pdf[0].filename, req);
    pdfPath = req.files.pdf[0].path;
    console.log('[v0] PDF file:', { pdfUrl, pdfPath });
  }
  
  // 2. Procesar imagen principal
  if (req.files?.primary_image?.[0]) {
    primaryImageUrl = getFileUrl(req.files.primary_image[0].filename, req);
    primaryImagePath = req.files.primary_image[0].path;
    hasPrimaryImage = true;
    console.log('[v0] Primary image:', { primaryImageUrl, primaryImagePath });
  }
  
  // 3. Verificar que al menos haya imagen principal
  if (!hasPrimaryImage) {
    if (req.files) Object.values(req.files).flat().forEach(f => safeUnlink(f.path));
    return res.status(400).json({ error: "La imagen principal es requerida" });
  }

  // 4. Insertar en createcto_projects CON la imagen principal y PDF
  db.query(
    `INSERT INTO createcto_projects(name, description, location, latitude, longitude, contact_whatsapp, pdf_path, pdf_url, image_url, image_path, display_order)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, description || null, location || null, latitude || null, longitude || null, 
     contact_whatsapp || null, pdfPath, pdfUrl, primaryImageUrl, primaryImagePath, display_order || 0],
    (err, result) => {
      if (err) {
        console.error('[v0] Error creating project:', err);
        if (req.files) Object.values(req.files).flat().forEach(f => safeUnlink(f.path));
        return res.status(500).json({ error: err.message });
      }

      const projectId = result.insertId;
      console.log('[v0] Project created with ID:', projectId);
      
      // Ahora procesar imágenes adicionales en createcto_project_images
      let imagesProcessed = false;
      let floorsProcessed = false;

      const checkDone = () => {
        if (imagesProcessed && floorsProcessed) {
          console.log('[v0] Project creation complete for ID:', projectId);
          res.json({ id: projectId, message: "Proyecto creado exitosamente" });
        }
      };

      // Procesar imágenes adicionales
      const additionalImages = [];
      if (req.files?.images) {
        req.files.images.forEach(f => additionalImages.push({ file: f, isPrimary: false }));
      }

      // Insertar imagen principal también en createcto_project_images (como primaria)
      db.query(
        `INSERT INTO createcto_project_images(project_id, image_path, image_url, display_order, is_primary)
        VALUES(?, ?, ?, 0, 1)`,
        [projectId, primaryImagePath, primaryImageUrl],
        (err) => {
          if (err) console.error('[v0] Error inserting primary image:', err);
        }
      );

      if (additionalImages.length === 0) {
        imagesProcessed = true;
        checkDone();
      } else {
        console.log('[v0] Processing additional images:', additionalImages.length);
  let count = 0;
  additionalImages.forEach((img, index) => {
    const imageUrl = getFileUrl(img.file.filename, req);
    db.query(
            `INSERT INTO createcto_project_images(project_id, image_path, image_url, display_order, is_primary)
            VALUES(?, ?, ?, ?, ?)`,
            [projectId, img.file.path, imageUrl, index + 1, 0],
            (errImg) => {
              if (errImg) console.error("[v0] Error inserting additional image:", errImg);
              count++;
              if (count === additionalImages.length) {
                imagesProcessed = true;
                checkDone();
              }
            }
          );
        });
      }

      // Procesar pisos
      if (!floors) {
        floorsProcessed = true;
        checkDone();
      } else {
        try {
          const floorsData = JSON.parse(floors);
          if (!Array.isArray(floorsData) || floorsData.length === 0) {
            floorsProcessed = true;
            checkDone();
            return;
          }

          let floorCount = 0;
          floorsData.forEach((floor) => {
            db.query(
              `INSERT INTO createcto_floors(project_id, floor_number, total_departments, square_meters, characteristics)
              VALUES(?, ?, ?, ?, ?)`,
              [projectId, floor.floor_number, floor.total_departments || 0, floor.square_meters || null, floor.characteristics || null],
              (err, floorResult) => {
                if (err) {
                  console.error('[v0] Error inserting floor:', err);
                  floorCount++;
                  if (floorCount === floorsData.length) { 
                    floorsProcessed = true; 
                    checkDone(); 
                  }
                  return;
                }

                const floorId = floorResult.insertId;
                const departments = floor.departments || [];

                if (departments.length === 0) {
                  floorCount++;
                  if (floorCount === floorsData.length) { 
                    floorsProcessed = true; 
                    checkDone(); 
                  }
                } else {
                  let deptCount = 0;
                  departments.forEach((dept) => {
                    // AGREGAR MONEDA al departamento
                    db.query(
                      `INSERT INTO createcto_departments(floor_id, department_number, size_sqm, bedrooms, bathrooms, has_balcony, has_parking, has_storage, characteristics, price, currency, status)
                      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                      [floorId, dept.department_number || dept.number, 
                       dept.size_sqm || dept.size || 0, 
                       dept.bedrooms || 1, 
                       dept.bathrooms || 1,
                       dept.has_balcony ? 1 : 0, 
                       dept.has_parking ? 1 : 0, 
                       dept.has_storage ? 1 : 0,
                       dept.characteristics || null, 
                       dept.price || 0,
                       dept.currency || 'USD', // NUEVO CAMPO
                       dept.status || 'available'],
                      (errDept) => {
                        if (errDept) console.error("[v0] Error inserting department:", errDept);
                        deptCount++;
                        if (deptCount === departments.length) {
                          floorCount++;
                          if (floorCount === floorsData.length) { 
                            floorsProcessed = true; 
                            checkDone(); 
                          }
                        }
                      }
                    );
                  });
                }
              }
            );
          });
        } catch (e) {
          console.error("Error parsing floors:", e);
          floorsProcessed = true;
          checkDone();
        }
      }
    }
  );
});
// UPDATE Project with files
app.put("/admin/createcto/projects/:id", upload.fields([
  { name: "primary_image", maxCount: 1 },
  { name: "new_images", maxCount: 15 },
  { name: "pdf", maxCount: 1 }
]), (req, res) => {
  const projectId = req.params.id
  const { name, description, location, latitude, longitude, contact_whatsapp, display_order, floors, images_to_delete } = req.body

  db.query("SELECT * FROM createcto_projects WHERE id = ?", [projectId], (err, result) => {
    if (err) return res.status(500).json({ error: err.message })
    if (result.length === 0) return res.status(404).json({ error: "Proyecto no encontrado" })

    const current = result[0]
    let pdfPath = current.pdf_path, pdfUrl = current.pdf_url

    if (req.files?.pdf?.[0]) {
  if (current.pdf_path) safeUnlink(current.pdf_path)
    pdfPath = req.files.pdf[0].path
    pdfUrl = getFileUrl(req.files.pdf[0].filename, req)
  }

    db.query(
      `UPDATE createcto_projects SET name=?, description=?, location=?, latitude=?, longitude=?, contact_whatsapp=?, pdf_path=?, pdf_url=?, display_order=? WHERE id=?`,
      [name || current.name, description !== undefined ? description : current.description, location || current.location,
      latitude || current.latitude, longitude || current.longitude, contact_whatsapp || current.contact_whatsapp,
        pdfPath, pdfUrl, display_order || current.display_order, projectId],
      (errUpdate) => {
        if (errUpdate) return res.status(500).json({ error: errUpdate.message })

        let deleteImagesDone = false, addImagesDone = false, floorsDone = false

        const checkDone = () => {
          if (deleteImagesDone && addImagesDone && floorsDone) {
            res.json({ message: "Proyecto actualizado exitosamente" })
          }
        }

        // Delete specified images
        if (!images_to_delete) {
          deleteImagesDone = true
          checkDone()
        } else {
          const idsToDelete = parseCsvIds(images_to_delete)
          if (idsToDelete.length === 0) {
            deleteImagesDone = true
            checkDone()
          } else {
            db.query(
              `SELECT id, image_path FROM createcto_project_images WHERE project_id = ? AND id IN (${idsToDelete.map(() => '?').join(',')})`,
              [projectId, ...idsToDelete],
              (errSel, rows) => {
                if (rows) rows.forEach(r => safeUnlink(r.image_path))
                db.query(
                  `DELETE FROM createcto_project_images WHERE project_id = ? AND id IN (${idsToDelete.map(() => '?').join(',')})`,
                  [projectId, ...idsToDelete],
                  () => { deleteImagesDone = true; checkDone() }
                )
              }
            )
          }
        }

        // Add new images
        const newImages = []
        if (req.files?.primary_image?.[0]) newImages.push({ file: req.files.primary_image[0], isPrimary: true })
        if (req.files?.new_images) req.files.new_images.forEach(f => newImages.push({ file: f, isPrimary: false }))

        if (newImages.length === 0) {
          addImagesDone = true
          checkDone()
        } else {
          db.query(`SELECT COALESCE(MAX(display_order), -1) as maxOrder FROM createcto_project_images WHERE project_id = ?`, [projectId], (errMax, maxRows) => {
            const startOrder = (maxRows?.[0]?.maxOrder || -1) + 1
            let count = 0
            newImages.forEach((img, index) => {
              const imageUrl = `/uploads/${img.file.filename}`
              db.query(
                `INSERT INTO createcto_project_images(project_id, image_path, image_url, display_order, is_primary) VALUES(?, ?, ?, ?, ?)`,
                [projectId, img.file.path, imageUrl, startOrder + index, img.isPrimary ? 1 : 0],
                () => { count++; if (count === newImages.length) { addImagesDone = true; checkDone() } }
              )
            })
          })
        }

        // Update floors if provided
        if (!floors) {
          floorsDone = true
          checkDone()
        } else {
          try {
            const floorsData = JSON.parse(floors)
            // Delete existing floors and departments
            db.query(`SELECT id FROM createcto_floors WHERE project_id = ?`, [projectId], (err, existingFloors) => {
              const floorIds = existingFloors?.map(f => f.id) || []

              const deleteAndInsert = () => {
                db.query(`DELETE FROM createcto_floors WHERE project_id = ?`, [projectId], () => {
                  if (!Array.isArray(floorsData) || floorsData.length === 0) {
                    floorsDone = true
                    checkDone()
                    return
                  }

                  let floorCount = 0
                  floorsData.forEach((floor) => {
                    db.query(
                      `INSERT INTO createcto_floors(project_id, floor_number, total_departments, square_meters, characteristics) VALUES(?, ?, ?, ?, ?)`,
                      [projectId, floor.floor_number, floor.total_departments || 0, floor.square_meters || null, floor.characteristics || null],
                      (err, floorResult) => {
                        if (err) { floorCount++; if (floorCount === floorsData.length) { floorsDone = true; checkDone() } return }

                        const floorId = floorResult.insertId
                        const departments = floor.departments || []

                        if (departments.length === 0) {
                          floorCount++; if (floorCount === floorsData.length) { floorsDone = true; checkDone() }
                        } else {
                          let deptCount = 0
                          departments.forEach((dept) => {
                            db.query(
                              `INSERT INTO createcto_departments(floor_id, department_number, size_sqm, bedrooms, bathrooms, has_balcony, has_parking, has_storage, characteristics, price, status) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                              [floorId, dept.department_number || dept.number, dept.size_sqm || dept.size, dept.bedrooms || 1, dept.bathrooms || 1, dept.has_balcony ? 1 : 0, dept.has_parking ? 1 : 0, dept.has_storage ? 1 : 0, dept.characteristics || null, dept.price || null, dept.status || 'available'],
                              () => { deptCount++; if (deptCount === departments.length) { floorCount++; if (floorCount === floorsData.length) { floorsDone = true; checkDone() } } }
                            )
                          })
                        }
                      }
                    )
                  })
                })
              }

              if (floorIds.length > 0) {
                db.query(`DELETE FROM createcto_departments WHERE floor_id IN (${floorIds.map(() => '?').join(',')})`, floorIds, deleteAndInsert)
              } else {
                deleteAndInsert()
              }
            })
          } catch (e) {
            console.error("Error parsing floors:", e)
            floorsDone = true
            checkDone()
          }
        }
      }
    )
  })
})

// DELETE Project
app.delete("/admin/createcto/projects/:id", (req, res) => {
  const projectId = req.params.id

  // Get all images and PDF to delete files
  db.query("SELECT image_path FROM createcto_project_images WHERE project_id = ?", [projectId], (err, images) => {
    db.query("SELECT pdf_path FROM createcto_projects WHERE id = ?", [projectId], (err2, projects) => {
      // Delete related data
      db.query("SELECT id FROM createcto_floors WHERE project_id = ?", [projectId], (err3, floors) => {
        const floorIds = floors?.map(f => f.id) || []

        const deleteProject = () => {
          db.query("DELETE FROM createcto_project_images WHERE project_id = ?", [projectId], () => {
            db.query("DELETE FROM createcto_floors WHERE project_id = ?", [projectId], () => {
              db.query("DELETE FROM createcto_projects WHERE id = ?", [projectId], (errDel) => {
                if (errDel) return res.status(500).json({ error: errDel.message })

                // Delete files
                if (images) images.forEach(i => safeUnlink(i.image_path))
                if (projects?.[0]?.pdf_path) safeUnlink(projects[0].pdf_path)

                res.json({ message: "Proyecto eliminado exitosamente" })
              })
            })
          })
        }

        if (floorIds.length > 0) {
          db.query(`DELETE FROM createcto_departments WHERE floor_id IN (${floorIds.map(() => '?').join(',')})`, floorIds, deleteProject)
        } else {
          deleteProject()
        }
      })
    })
  })
})

// GET Images for a project
app.get("/admin/createcto/projects/:id/images", (req, res) => {
  db.query(
    `SELECT id, image_url, display_order, is_primary FROM createcto_project_images WHERE project_id = ? ORDER BY display_order ASC`,
    [req.params.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message })
      res.json(rows)
    }
  )
})

// ADD Image to project
app.post("/admin/createcto/projects/:id/images", upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Imagen requerida" })

  const projectId = req.params.id
  const { is_primary } = req.body
  const imageUrl = getFileUrl(req.file.filename, req);

  db.query(`SELECT COALESCE(MAX(display_order), -1) as maxOrder FROM createcto_project_images WHERE project_id = ?`, [projectId], (err, maxRows) => {
    const order = (maxRows?.[0]?.maxOrder || -1) + 1
    db.query(
      `INSERT INTO createcto_project_images(project_id, image_path, image_url, display_order, is_primary) VALUES(?, ?, ?, ?, ?)`,
      [projectId, req.file.path, imageUrl, order, is_primary === 'true' || is_primary === true ? 1 : 0],
      (err, result) => {
        if (err) return res.status(500).json({ error: err.message })
        res.json({ id: result.insertId, image_url: imageUrl })
      }
    )
  })
})

// DELETE Image
// DELETE specific image
app.delete("/admin/createcto/images/:id", (req, res) => {
  const imageId = req.params.id;
  
  // Primero obtener info de la imagen
  db.query(
    `SELECT image_path, project_id, is_primary 
     FROM createcto_project_images 
     WHERE id = ?`,
    [imageId],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (results.length === 0) return res.status(404).json({ error: "Imagen no encontrada" });
      
      const image = results[0];
      
      // Eliminar archivo físico
      safeUnlink(image.image_path);
      
      // Eliminar de la base de datos
      db.query(
        `DELETE FROM createcto_project_images WHERE id = ?`,
        [imageId],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          
          // Si la imagen eliminada era primaria, asignar otra como primaria
          if (image.is_primary === 1) {
            db.query(
              `SELECT id FROM createcto_project_images 
               WHERE project_id = ? 
               ORDER BY display_order ASC 
               LIMIT 1`,
              [image.project_id],
              (err, newPrimary) => {
                if (!err && newPrimary.length > 0) {
                  db.query(
                    `UPDATE createcto_project_images SET is_primary = 1 WHERE id = ?`,
                    [newPrimary[0].id]
                  );
                }
              }
            );
          }
          
          res.json({ message: "Imagen eliminada correctamente" });
        }
      );
    }
  );
});
// ==========================
// 🔐 INVERSIONES - AUTENTICACIÓN
// ==========================
app.post("/inversiones/register", (req, res) => {
  const { email, password, name, ci, nationality, professional_profile, phone, role = "investor" } = req.body

  if (!email || !password || !name || !ci) {
    return res.status(400).json({ error: "Email, contraseña, nombre y CI son requeridos" })
  }

  const hashedPassword = bcrypt.hashSync(password, 8)

  db.query(
    "INSERT INTO inversiones_investors(email, password, name, ci, nationality, professional_profile, phone, role) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
    [email, hashedPassword, name, ci, nationality || "", professional_profile || "", phone || "", role],
    (err, result) => {
      if (err) {
        if (err.code === "ER_DUP_ENTRY") {
          return res.status(400).json({ error: "Email o CI ya registrado" })
        }
        return res.status(500).json({ error: err.message })
      }

      const token = jwt.sign({ id: result.insertId, role: role }, SECRET)
      res.json({ token, role: role, id: result.insertId })
    },
  )
})

app.post("/inversiones/login", (req, res) => {
  const { email, password } = req.body

  db.query(
    "SELECT id, email, password, name, phone, role, ci FROM inversiones_investors WHERE email=?",
    [email],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message })
      if (result.length === 0) return res.status(401).json({ error: "Usuario no existe" })

      const user = result[0]

      if (!bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: "Contraseña incorrecta" })
      }

      const token = jwt.sign({ id: user.id, role: user.role }, SECRET)

      res.json({
        token,
        role: user.role,
        id: user.id,
        name: user.name,
        email: user.email,
        ci: user.ci,
      })
    },
  )
})

// ==========================
// 📊 INVERSIONES - ADMIN DASHBOARD
// ==========================
app.get("/admin/inversiones/dashboard", (req, res) => {
  const queries = [
    "SELECT COUNT(*) as total FROM inversiones_projects",
    "SELECT COUNT(*) as total FROM inversiones_investors WHERE role='investor'",
    "SELECT SUM(min_investment) as total_min FROM inversiones_projects",
    "SELECT SUM(expected_return) as avg_return FROM inversiones_projects",
  ]

  const results = {}
  let completed = 0

  queries.forEach((query, idx) => {
    db.query(query, (err, result) => {
      if (!err && result.length > 0) {
        const key = ["projects", "investors", "min_investment", "avg_return"][idx]
        results[key] = result[0][Object.keys(result[0])[0]]
      }
      completed++
      if (completed === queries.length) {
        res.json(results)
      }
    })
  })
})

// ==========================
// 📁 INVERSIONES - PROYECTOS
// ==========================
app.get("/admin/projects", (req, res) => {
  db.query(
    "SELECT * FROM inversiones_projects ORDER BY created_at DESC",
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message })
      const updated = regenerateImageUrlsInArray(result, req, ["image_url"])
      res.json(updated)
    },
  )
})

app.get("/admin/projects/:id", (req, res) => {
  db.query(
    "SELECT * FROM inversiones_projects WHERE id = ?",
    [req.params.id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message })
      if (result.length === 0) return res.status(404).json({ error: "Proyecto no encontrado" })
      
      const project = result[0]
      if (project.image_url) {
        project.image_url = regenerateImageUrl(project.image_url, req)
      }
      res.json(project)
    },
  )
})

app.post("/admin/projects", upload.single("image"), (req, res) => {
  const {
    name,
    description,
    location,
    project_type,
    investment_type,
    min_investment,
    max_investment,
    funding_goal,
    expected_return,
    investment_period_months,
    start_date,
  } = req.body

  if (!name) {
    if (req.file) safeUnlink(req.file.path)
    return res.status(400).json({ error: "El nombre del proyecto es requerido" })
  }

  const imageUrl = req.file ? getFileUrl(req.file.filename, req) : null

  db.query(
    `INSERT INTO inversiones_projects(name, description, location, project_type, investment_type, min_investment, max_investment, funding_goal, expected_return, investment_period_months, start_date, image_url, status)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      description || "",
      location || "",
      project_type || "",
      investment_type || "",
      min_investment || 0,
      max_investment || 0,
      funding_goal || 0,
      expected_return || 0,
      investment_period_months || 0,
      start_date || null,
      imageUrl,
      "planning",
    ],
    (err, result) => {
      if (err) {
        if (req.file) safeUnlink(req.file.path)
        return res.status(500).json({ error: err.message })
      }
      res.json({ id: result.insertId, message: "Proyecto creado exitosamente" })
    },
  )
})

app.put("/admin/projects/:id", upload.single("image"), (req, res) => {
  const {
    name,
    description,
    location,
    project_type,
    investment_type,
    min_investment,
    max_investment,
    funding_goal,
    expected_return,
    investment_period_months,
    start_date,
    status,
  } = req.body

  db.query("SELECT * FROM inversiones_projects WHERE id = ?", [req.params.id], (err, result) => {
    if (err) {
      if (req.file) safeUnlink(req.file.path)
      return res.status(500).json({ error: err.message })
    }
    if (result.length === 0) {
      if (req.file) safeUnlink(req.file.path)
      return res.status(404).json({ error: "Proyecto no encontrado" })
    }

    let finalImageUrl = result[0].image_url
    if (req.file) {
      finalImageUrl = getFileUrl(req.file.filename, req)
    }

    db.query(
      `UPDATE inversiones_projects SET name=?, description=?, location=?, project_type=?, investment_type=?, min_investment=?, max_investment=?, funding_goal=?, expected_return=?, investment_period_months=?, start_date=?, image_url=?, status=? WHERE id=?`,
      [
        name,
        description || "",
        location || "",
        project_type || "",
        investment_type || "",
        min_investment || 0,
        max_investment || 0,
        funding_goal || 0,
        expected_return || 0,
        investment_period_months || 0,
        start_date || null,
        finalImageUrl,
        status || "planning",
        req.params.id,
      ],
      (err2) => {
        if (err2) {
          if (req.file) safeUnlink(req.file.path)
          return res.status(500).json({ error: err2.message })
        }
        res.json({ message: "Proyecto actualizado" })
      },
    )
  })
})

app.delete("/admin/projects/:id", (req, res) => {
  db.query("DELETE FROM inversiones_projects WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json({ message: "Proyecto eliminado" })
  })
})

// ==========================
// 📰 INVERSIONES - NOTICIAS
// ==========================
app.get("/admin/projects/:id/news", (req, res) => {
  db.query(
    "SELECT * FROM inversiones_news WHERE project_id = ? ORDER BY created_at DESC",
    [req.params.id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message })
      const updated = regenerateImageUrlsInArray(result, req, ["image_url"])
      res.json(updated)
    },
  )
})

app.post("/admin/news", upload.single("image"), (req, res) => {
  const { project_id, title, news_type, content, created_date } = req.body

  if (!project_id || !title) {
    if (req.file) safeUnlink(req.file.path)
    return res.status(400).json({ error: "Proyecto y título son requeridos" })
  }

  const imageUrl = req.file ? getFileUrl(req.file.filename, req) : null

  db.query(
    `INSERT INTO inversiones_news(project_id, title, news_type, content, image_url, created_date, investment_id)
     VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [project_id, title, news_type || "", content || "", imageUrl, created_date || null, project_id],
    (err, result) => {
      if (err) {
        if (req.file) safeUnlink(req.file.path)
        return res.status(500).json({ error: err.message })
      }
      res.json({ id: result.insertId, message: "Noticia creada" })
    },
  )
})

app.put("/admin/news/:id", upload.single("image"), (req, res) => {
  const { title, news_type, content, created_date } = req.body

  db.query("SELECT * FROM inversiones_news WHERE id = ?", [req.params.id], (err, result) => {
    if (err) {
      if (req.file) safeUnlink(req.file.path)
      return res.status(500).json({ error: err.message })
    }
    if (result.length === 0) {
      if (req.file) safeUnlink(req.file.path)
      return res.status(404).json({ error: "Noticia no encontrada" })
    }

    let finalImageUrl = result[0].image_url
    if (req.file) {
      finalImageUrl = getFileUrl(req.file.filename, req)
    }

    db.query(
      `UPDATE inversiones_news SET title=?, news_type=?, content=?, image_url=?, created_date=? WHERE id=?`,
      [title, news_type || "", content || "", finalImageUrl, created_date || null, req.params.id],
      (err2) => {
        if (err2) {
          if (req.file) safeUnlink(req.file.path)
          return res.status(500).json({ error: err2.message })
        }
        res.json({ message: "Noticia actualizada" })
      },
    )
  })
})

app.delete("/admin/news/:id", (req, res) => {
  db.query("DELETE FROM inversiones_news WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json({ message: "Noticia eliminada" })
  })
})

// ==========================
// 📊 INVERSIONES - FASES
// ==========================
app.get("/admin/projects/:id/phases", (req, res) => {
  db.query(
    "SELECT * FROM inversiones_phases WHERE project_id = ? ORDER BY phase_number ASC",
    [req.params.id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message })
      res.json(result || [])
    },
  )
})

app.post("/admin/phases", (req, res) => {
  const { project_id, phase_number, name, description, planned_percentage, status, planned_start_date, planned_end_date } = req.body

  if (!project_id || !phase_number) {
    return res.status(400).json({ error: "Proyecto y número de fase son requeridos" })
  }

  db.query(
    `INSERT INTO inversiones_phases(project_id, investment_id, phase_number, name, description, planned_percentage, status, planned_start_date, planned_end_date)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [project_id, project_id, phase_number, name || "", description || "", planned_percentage || 0, status || "planned", planned_start_date || null, planned_end_date || null],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message })
      res.json({ id: result.insertId, message: "Fase creada" })
    },
  )
})

app.put("/admin/phases/:id", (req, res) => {
  const { name, description, planned_percentage, actual_percentage, status, planned_start_date, planned_end_date, actual_start_date, actual_end_date } = req.body

  db.query(
    `UPDATE inversiones_phases SET name=?, description=?, planned_percentage=?, actual_percentage=?, status=?, planned_start_date=?, planned_end_date=?, actual_start_date=?, actual_end_date=? WHERE id=?`,
    [name || "", description || "", planned_percentage || 0, actual_percentage || 0, status || "planned", planned_start_date || null, planned_end_date || null, actual_start_date || null, actual_end_date || null, req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message })
      res.json({ message: "Fase actualizada" })
    },
  )
})

app.delete("/admin/phases/:id", (req, res) => {
  db.query("DELETE FROM inversiones_phases WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json({ message: "Fase eliminada" })
  })
})

// ==========================
// 📄 INVERSIONES - DOCUMENTOS
// ==========================
app.get("/admin/projects/:id/documents", (req, res) => {
  db.query(
    "SELECT * FROM inversiones_documents WHERE project_id = ? ORDER BY uploaded_at DESC",
    [req.params.id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message })
      res.json(result || [])
    },
  )
})

app.post("/admin/documents", upload.single("file"), (req, res) => {
  const { project_id, document_type, document_name } = req.body

  if (!project_id || !req.file) {
    if (req.file) safeUnlink(req.file.path)
    return res.status(400).json({ error: "Proyecto y archivo son requeridos" })
  }

  const fileUrl = getFileUrl(req.file.filename, req)
  const fileName = document_name || req.file.originalname

  db.query(
    `INSERT INTO inversiones_documents(project_id, investment_id, document_type, document_name, document_url, file_path)
     VALUES(?, ?, ?, ?, ?, ?)`,
    [project_id, project_id, document_type || "", fileName, fileUrl, req.file.path],
    (err, result) => {
      if (err) {
        safeUnlink(req.file.path)
        return res.status(500).json({ error: err.message })
      }
      res.json({ id: result.insertId, message: "Documento subido" })
    },
  )
})

app.delete("/admin/documents/:id", (req, res) => {
  db.query("SELECT file_path FROM inversiones_documents WHERE id = ?", [req.params.id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message })
    if (result.length > 0 && result[0].file_path) {
      safeUnlink(result[0].file_path)
    }

    db.query("DELETE FROM inversiones_documents WHERE id = ?", [req.params.id], (err2) => {
      if (err2) return res.status(500).json({ error: err2.message })
      res.json({ message: "Documento eliminado" })
    })
  })
})

// ==========================
// 👥 INVERSIONES - INVERSIONISTAS
// ==========================
app.get("/admin/inversiones/investors", (req, res) => {
  db.query(
    "SELECT id, name, email, ci, nationality, professional_profile, total_invested, created_at FROM inversiones_investors WHERE role='investor' ORDER BY created_at DESC",
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message })
      res.json(result)
    },
  )
})

// ==========================
// 🚀 INICIAR SERVIDOR
// ==========================
app.listen(3000, "0.0.0.0", () => {
  console.log("✓ Servidor corriendo en http://0.0.0.0:3000")
  console.log("✓ Para emulador Android: /uploads/")
  console.log("✓ Rutas Inmobiliaria: /properties, /admin/banners, etc.")
  console.log("✓ Rutas Inversiones: /inversiones/login, /admin/projects, /admin/news, /admin/phases, /admin/documents")
})
