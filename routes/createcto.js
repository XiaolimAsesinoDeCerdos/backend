const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

module.exports = function(db, upload, transporter) {
  const router = express.Router();

  // ==============================
  // CREATECTO PROJECTS - CRUD
  // ==============================

  // GET all projects with images and floors
  router.get('/projects', (req, res) => {
    const sql = `
      SELECT 
        p.*,
        GROUP_CONCAT(DISTINCT CONCAT(i.id, '|', i.image_url, '|', i.is_primary, '|', i.display_order) SEPARATOR '::') as images_data
      FROM createcto_projects p
      LEFT JOIN createcto_project_images i ON p.id = i.project_id
      GROUP BY p.id
      ORDER BY p.display_order ASC
    `;
    
    db.query(sql, (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      
      const projects = results.map(p => {
        const images = p.images_data 
          ? p.images_data.split('::').map(img => {
              const [id, image_url, is_primary, display_order] = img.split('|');
              return { id: parseInt(id), image_url, is_primary: is_primary === '1', display_order: parseInt(display_order) };
            })
          : [];
        
        return { ...p, images };
      });
      
      res.json(projects);
    });
  });

  // GET single project with all data
  router.get('/projects/:id', (req, res) => {
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
                  return { id: parseInt(id), department_number: parseInt(dept_num), area_sqm: parseFloat(sqm), availability_status: status };
                })
              : [];
            return { ...f, departments };
          });
          
          res.json({ ...project, images, floors: floorsData });
        });
      });
    });
  });

  // CREATE project - Middleware personalizado para aceptar primary_image + images
  const multiUpload = upload.fields([
    { name: 'primary_image', maxCount: 1 },
    { name: 'images', maxCount: 10 }
  ]);

  router.post('/projects', multiUpload, (req, res) => {
    const { name, description, location, contact_whatsapp, display_order, floors } = req.body;
    
    if (!name || !description) {
      return res.status(400).json({ error: 'name y description son requeridos' });
    }
    
    const sql = `
      INSERT INTO createcto_projects (name, description, location, contact_whatsapp, display_order)
      VALUES (?, ?, ?, ?, ?)
    `;
    
    db.query(sql, [name, description, location || null, contact_whatsapp || null, display_order || 0], (err, result) => {
      if (err) {
        console.log('[v0] Error creating project:', err);
        return res.status(500).json({ error: err.message });
      }
      
      const projectId = result.insertId;
      let imageSaved = false;
      
      // Add primary image first (is_primary = 1)
      if (req.files && req.files.primary_image && req.files.primary_image.length > 0) {
        const file = req.files.primary_image[0];
        const imgSql = `
          INSERT INTO createcto_project_images (project_id, image_url, display_order, is_primary)
          VALUES (?, ?, ?, 1)
        `;
        db.query(imgSql, [projectId, `/uploads/${file.filename}`, 0], (err) => {
          if (err) console.log('[v0] Error saving primary image:', err);
          else imageSaved = true;
        });
      }
      
      // Add additional images
      if (req.files && req.files.images && req.files.images.length > 0) {
        req.files.images.forEach((file, index) => {
          const imgSql = `
            INSERT INTO createcto_project_images (project_id, image_url, display_order, is_primary)
            VALUES (?, ?, ?, 0)
          `;
          db.query(imgSql, [projectId, `/uploads/${file.filename}`, index + 1]);
        });
      }
      
      // Add floors if provided
      if (floors) {
        try {
          const floorsList = typeof floors === 'string' ? JSON.parse(floors) : floors;
          if (Array.isArray(floorsList)) {
            floorsList.forEach(floor => {
              const floorSql = `
                INSERT INTO createcto_floors (project_id, floor_number, total_departments)
                VALUES (?, ?, ?)
              `;
              db.query(floorSql, [projectId, floor.floor_number, floor.total_departments], (err) => {
                if (err) console.log('[v0] Error adding floor:', err);
              });
            });
          }
        } catch (e) {
          console.log('[v0] Error parsing floors:', e);
        }
      }
      
      res.status(201).json({ id: projectId, message: 'Proyecto creado correctamente' });
    });
  });


  // GET images for a project
  router.get('/projects/:id/images', (req, res) => {
    const projectId = req.params.id;
    
    const sql = `
      SELECT id, image_url, display_order, is_primary
      FROM createcto_project_images 
      WHERE project_id = ?
      ORDER BY is_primary DESC, display_order ASC
    `;
    
    db.query(sql, [projectId], (err, images) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(images);
    });
  });

  // UPDATE project - CORREGIDO
router.put('/projects/:id', upload.fields([
  { name: 'primary_image', maxCount: 1 },
  { name: 'new_images', maxCount: 10 }
]), (req, res) => {
  const projectId = req.params.id;
  const { 
    name, 
    description, 
    location, 
    contact_whatsapp, 
    display_order, 
    floors,
    images_to_delete // IDs de imágenes a eliminar separados por comas
  } = req.body;
  
  let updateSql = 'UPDATE createcto_projects SET name = ?, description = ?, location = ?, contact_whatsapp = ?, display_order = ? WHERE id = ?';
  let params = [name, description, location || null, contact_whatsapp || null, display_order || 0, projectId];
  
  db.query(updateSql, params, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    
    // 1. Eliminar imágenes especificadas
    if (images_to_delete) {
      const deleteIds = images_to_delete.split(',').filter(id => id.trim() !== '');
      if (deleteIds.length > 0) {
        // Primero obtener las rutas de las imágenes a eliminar
        db.query(
          'SELECT image_url FROM createcto_project_images WHERE id IN (?) AND project_id = ?',
          [deleteIds, projectId],
          (err, images) => {
            if (!err && images) {
              images.forEach(img => {
                const filePath = path.join(__dirname, '..', img.image_url);
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
              });
            }
            
            // Eliminar de la base de datos
            db.query(
              'DELETE FROM createcto_project_images WHERE id IN (?) AND project_id = ?',
              [deleteIds, projectId]
            );
          }
        );
      }
    }
    
    // 2. Agregar nueva imagen principal si se subió
    if (req.files && req.files.primary_image && req.files.primary_image.length > 0) {
      const file = req.files.primary_image[0];
      
      // Primero, quitar el estado de primaria de todas las imágenes actuales
      db.query('UPDATE createcto_project_images SET is_primary = 0 WHERE project_id = ?', [projectId]);
      
      // Luego agregar la nueva imagen como primaria
      const imgSql = `
        INSERT INTO createcto_project_images (project_id, image_url, display_order, is_primary)
        VALUES (?, ?, ?, 1)
      `;
      db.query(imgSql, [projectId, `/uploads/${file.filename}`, 0]);
    }
    
    // 3. Agregar imágenes adicionales
    if (req.files && req.files.new_images && req.files.new_images.length > 0) {
      // Obtener el máximo display_order actual
      db.query('SELECT COALESCE(MAX(display_order), 0) as maxOrder FROM createcto_project_images WHERE project_id = ?', 
        [projectId], 
        (err, result) => {
          if (err) console.log('[v0] Error getting max order:', err);
          
          const startOrder = (result && result[0]?.maxOrder) ? result[0].maxOrder + 1 : 1;
          
          req.files.new_images.forEach((file, index) => {
            const imgSql = `
              INSERT INTO createcto_project_images (project_id, image_url, display_order, is_primary)
              VALUES (?, ?, ?, 0)
            `;
            db.query(imgSql, [projectId, `/uploads/${file.filename}`, startOrder + index]);
          });
        }
      );
    }
    
    // 4. Actualizar pisos si se proporcionaron
    if (floors) {
      try {
        const floorsList = typeof floors === 'string' ? JSON.parse(floors) : floors;
        if (Array.isArray(floorsList)) {
          floorsList.forEach(floor => {
            if (floor.id) {
              const floorSql = `
                UPDATE createcto_floors 
                SET floor_number = ?, total_departments = ?
                WHERE id = ? AND project_id = ?
              `;
              db.query(floorSql, [floor.floor_number, floor.total_departments, floor.id, projectId]);
            } else {
              // Crear nuevo piso
              const floorSql = `
                INSERT INTO createcto_floors (project_id, floor_number, total_departments)
                VALUES (?, ?, ?)
              `;
              db.query(floorSql, [projectId, floor.floor_number, floor.total_departments]);
            }
          });
        }
      } catch (e) {
        console.log('[v0] Error parsing floors:', e);
      }
    }
    
    res.json({ message: 'Proyecto actualizado correctamente' });
  });
});

  // DELETE project
  router.delete('/projects/:id', (req, res) => {
    const projectId = req.params.id;
    
    // Delete images
    const imgSql = 'SELECT image_url FROM createcto_project_images WHERE project_id = ?';
    db.query(imgSql, [projectId], (err, images) => {
      if (images) {
        images.forEach(img => {
          const filePath = path.join(__dirname, '..', img.image_url);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        });
      }
      
      // Delete all related data
      db.query('DELETE FROM createcto_departments WHERE floor_id IN (SELECT id FROM createcto_floors WHERE project_id = ?)', [projectId]);
      db.query('DELETE FROM createcto_floors WHERE project_id = ?', [projectId]);
      db.query('DELETE FROM createcto_project_images WHERE project_id = ?', [projectId]);
      db.query('DELETE FROM createcto_projects WHERE id = ?', [projectId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Proyecto eliminado correctamente' });
      });
    });
  });

  // ==============================
  // PROJECT IMAGES
  // ==============================

  router.post('/projects/:projectId/images', upload.single('image'), (req, res) => {
    const projectId = req.params.projectId;
    const { is_primary } = req.body;
    
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    
    const sql = `
      INSERT INTO createcto_project_images (project_id, image_url, is_primary, display_order)
      VALUES (?, ?, ?, ?)
    `;
    db.query(sql, [projectId, `/uploads/${req.file.filename}`, is_primary === 'true' ? 1 : 0, Date.now()], (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: result.insertId, image_url: `/uploads/${req.file.filename}` });
    });
  });

  router.delete('/images/:imageId', (req, res) => {
    const imageId = req.params.imageId;
    
    const sql = 'SELECT image_url FROM createcto_project_images WHERE id = ?';
    db.query(sql, [imageId], (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      
      if (results.length > 0) {
        const filePath = path.join(__dirname, '..', results[0].image_url);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      
      db.query('DELETE FROM createcto_project_images WHERE id = ?', [imageId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Imagen eliminada' });
      });
    });
  });

  // ==============================
  // FLOORS
  // ==============================

  router.post('/projects/:projectId/floors', (req, res) => {
    const projectId = req.params.projectId;
    const { floor_number, total_departments, square_meters, characteristics } = req.body;
    
    const sql = `
      INSERT INTO createcto_floors (project_id, floor_number, total_departments, square_meters, characteristics)
      VALUES (?, ?, ?, ?, ?)
    `;
    db.query(sql, [projectId, floor_number, total_departments, square_meters, characteristics], (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: result.insertId, floor_number, total_departments });
    });
  });

  router.put('/floors/:floorId', (req, res) => {
    const floorId = req.params.floorId;
    const { floor_number, total_departments, square_meters, characteristics } = req.body;
    
    const sql = `
      UPDATE createcto_floors 
      SET floor_number = ?, total_departments = ?, square_meters = ?, characteristics = ?
      WHERE id = ?
    `;
    db.query(sql, [floor_number, total_departments, square_meters, characteristics, floorId], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Piso actualizado' });
    });
  });

  router.delete('/floors/:floorId', (req, res) => {
    const floorId = req.params.floorId;
    
    db.query('DELETE FROM createcto_departments WHERE floor_id = ?', [floorId]);
    db.query('DELETE FROM createcto_floors WHERE id = ?', [floorId], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Piso eliminado' });
    });
  });

  // ==============================
  // DEPARTMENTS
  // ==============================

  router.post('/floors/:floorId/departments', (req, res) => {
  const floorId = req.params.floorId;
  const { 
    department_number, 
    size_sqm, 
    price_per_sqm,
    bedrooms, 
    bathrooms, 
    has_balcony, 
    has_parking, 
    has_storage,
    characteristics,
    currency, // NUEVO CAMPO
    status 
  } = req.body;
  
  // Calcular el precio total: size_sqm * price_per_sqm
  const totalPrice = size_sqm && price_per_sqm ? (parseFloat(size_sqm) * parseFloat(price_per_sqm)) : null;
  
  const sql = `
    INSERT INTO createcto_departments 
    (floor_id, department_number, size_sqm, bedrooms, bathrooms, has_balcony, has_parking, has_storage, characteristics, price, currency, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    floorId, 
    department_number, 
    size_sqm, 
    bedrooms || 1,
    bathrooms || 1,
    has_balcony ? 1 : 0,
    has_parking ? 1 : 0,
    has_storage ? 1 : 0,
    characteristics || null,
    totalPrice, // Precio calculado
    currency || 'USD', // NUEVO
    status || 'available'
  ];
  
  db.query(sql, params, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ 
      id: result.insertId, 
      department_number, 
      size_sqm,
      price_per_sqm,
      price: totalPrice,
      bedrooms,
      bathrooms,
      has_balcony,
      has_parking,
      has_storage,
      characteristics,
      currency, // NUEVO
      status 
    });
  });
});

  router.put('/departments/:deptId', (req, res) => {
  const deptId = req.params.deptId;
  const { 
    size_sqm, 
    price_per_sqm,
    bedrooms, 
    bathrooms, 
    has_balcony, 
    has_parking, 
    has_storage,
    characteristics,
    currency, // NUEVO CAMPO
    status 
  } = req.body;
  
  // Calcular el precio total: size_sqm * price_per_sqm
  const totalPrice = size_sqm && price_per_sqm ? (parseFloat(size_sqm) * parseFloat(price_per_sqm)) : null;
  
  const sql = `
    UPDATE createcto_departments 
    SET size_sqm = ?, bedrooms = ?, bathrooms = ?, has_balcony = ?, has_parking = ?, has_storage = ?, 
        characteristics = ?, price = ?, currency = ?, status = ?
    WHERE id = ?
  `;
  const params = [
    size_sqm,
    bedrooms || 1,
    bathrooms || 1,
    has_balcony ? 1 : 0,
    has_parking ? 1 : 0,
    has_storage ? 1 : 0,
    characteristics || null,
    totalPrice, // Precio calculado
    currency || 'USD', // NUEVO
    status || 'available',
    deptId
  ];
  
  db.query(sql, params, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Departamento actualizado' });
  });
});

  router.delete('/departments/:deptId', (req, res) => {
    db.query('DELETE FROM createcto_departments WHERE id = ?', [req.params.deptId], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Departamento eliminado' });
    });
  });


  // GET images for a specific project
app.get("/admin/createcto/projects/:id/images", (req, res) => {
  const projectId = req.params.id;
  
  db.query(
    `SELECT id, image_url, display_order, is_primary 
     FROM createcto_project_images 
     WHERE project_id = ? 
     ORDER BY is_primary DESC, display_order ASC`,
    [projectId],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    }
  );
});
  // ==============================
  // QUIENES SOMOS (About)
  // ==============================

  router.get('/admin/createcto/info', (req, res) => {
    const sql = `
      SELECT * FROM createcto_info LIMIT 1
    `;
    db.query(sql, (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      
      if (results.length === 0) {
        return res.json({ id: 1, about_text: '', logo_url: null });
      }
      
      const info = results[0];
      
      // Get social media
      const socialSql = 'SELECT * FROM createcto_social_media ORDER BY display_order';
      db.query(socialSql, (err, socials) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ...info, social_media: socials || [] });
      });
    });
  });

  router.put('/admin/createcto/info', upload.single('logo'), (req, res) => {
    const { about_text, QuienesSomos, mission, vision } = req.body;
    
    // Check if info exists
    const checkSql = 'SELECT id, logo_url FROM createcto_info LIMIT 1';
    db.query(checkSql, (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      
      let sql, params;
      if (results.length === 0) {
        sql = 'INSERT INTO createcto_info (about_text, QuienesSomos, mission, vision, logo_url) VALUES (?, ?, ?, ?, ?)';
        params = [
          about_text || null, 
          QuienesSomos || null,
          mission || null,
          vision || null,
          req.file ? `/uploads/${req.file.filename}` : null
        ];
      } else {
        let updates = [];
        params = [];
        
        if (about_text) {
          updates.push('about_text = ?');
          params.push(about_text);
        }
        
        if (QuienesSomos) {
          updates.push('QuienesSomos = ?');
          params.push(QuienesSomos);
        }
        
        if (mission) {
          updates.push('mission = ?');
          params.push(mission);
        }
        
        if (vision) {
          updates.push('vision = ?');
          params.push(vision);
        }
        
        if (req.file) {
          // Delete old logo if exists
          if (results[0].logo_url) {
            const filePath = path.join(__dirname, '..', results[0].logo_url);
            if (fs.existsSync(filePath)) {
              try {
                fs.unlinkSync(filePath);
              } catch (e) {
                console.log('[v0] Error deleting old logo:', e);
              }
            }
          }
          updates.push('logo_url = ?');
          params.push(`/uploads/${req.file.filename}`);
        }
        
        if (updates.length === 0) {
          return res.status(400).json({ error: 'No fields to update' });
        }
        
        sql = 'UPDATE createcto_info SET ' + updates.join(', ') + ' WHERE id = ?';
        params.push(results[0].id);
      }
      
      db.query(sql, params, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Información actualizada correctamente' });
      });
    });
  });

  // ==============================
  // DOCUMENTS
  // ==============================

  router.post('/documents', upload.single('document'), (req, res) => {
    const { document_name, document_type } = req.body;
    
    if (!req.file) return res.status(400).json({ error: 'No document provided' });
    
    const sql = `
      INSERT INTO createcto_documents (document_name, document_type, document_url, display_order)
      VALUES (?, ?, ?, ?)
    `;
    db.query(sql, [document_name, document_type, `/uploads/${req.file.filename}`, Date.now()], (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: result.insertId, document_url: `/uploads/${req.file.filename}` });
    });
  });

  router.delete('/documents/:docId', (req, res) => {
    const docId = req.params.docId;
    
    const sql = 'SELECT document_url FROM createcto_documents WHERE id = ?';
    db.query(sql, [docId], (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      
      if (results.length > 0) {
        const filePath = path.join(__dirname, '..', results[0].document_url);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      
      db.query('DELETE FROM createcto_documents WHERE id = ?', [docId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Documento eliminado' });
      });
    });
  });

  // ==============================
  // SOCIAL MEDIA
  // ==============================

  router.post('/social-media', (req, res) => {
    const { platform, url, visible } = req.body;
    
    const sql = `
      INSERT INTO createcto_social_media (platform, url, visible)
      VALUES (?, ?, ?)
    `;
    db.query(sql, [platform, url, visible ? 1 : 0], (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: result.insertId, platform, url, visible });
    });
  });

  router.put('/social-media/:socialId', (req, res) => {
    const socialId = req.params.socialId;
    const { url, visible } = req.body;
    
    const sql = `
      UPDATE createcto_social_media 
      SET url = ?, visible = ?
      WHERE id = ?
    `;
    db.query(sql, [url, visible ? 1 : 0, socialId], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Red social actualizada' });
    });
  });

  router.delete('/social-media/:socialId', (req, res) => {
    db.query('DELETE FROM createcto_social_media WHERE id = ?', [req.params.socialId], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Red social eliminada' });
    });
  });

  return router;
};
