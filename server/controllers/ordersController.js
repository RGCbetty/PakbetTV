const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const axios = require('axios');
const config = require('../config/keys');
const { v4: uuidv4 } = require('uuid');
const ninjaVanAuth = require('../services/ninjaVanAuth');
const API_BASE_URL = config.NINJAVAN_API_URL || 'https://api.ninjavan.co';
const COUNTRY_CODE = config.NINJAVAN_COUNTRY_CODE || 'PH';

async function createNinjaVanDelivery(orderData, shippingAddress, customerInfo) {
  // ...migrated as-is from the route file
}

async function createOrder(req, res) {
  // ...migrated as-is from the route file
}

async function getOrders(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    const [orders] = await db.query(
      `SELECT 
         o.order_id,
         o.order_code,
         o.order_status,
         o.payment_status,
         o.total_price,
         o.created_at,
         COALESCE(s.tracking_number, '')       AS tracking_number,
         COALESCE(s.address, '')              AS shipping_address,
         COUNT(oi.order_item_id)               AS item_count
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.order_id
       LEFT JOIN shipping     s ON s.order_id  = o.order_id
       WHERE o.user_id = ?
       GROUP BY o.order_id
       ORDER BY o.created_at DESC`,
       [userId]
    );

    res.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ message: 'Failed to fetch orders', error: error.message });
  }
}

async function getOrderById(req, res) {
  try {
    const userId = req.user?.id;
    const orderId = req.params.id;

    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Fetch basic order information along with shipping & payment details
    const [orderRows] = await db.query(
      `SELECT 
         o.order_id,
         o.order_code,
         o.order_status,
         o.payment_status,
         o.total_price,
         o.created_at,
         o.updated_at,
         -- Shipping details (nullable)
         s.tracking_number            AS tracking_number,
         s.address                    AS shipping_address,
         -- Payment details (nullable)
         pay.payment_method           AS payment_method,
         pay.transaction_id           AS transaction_id,
         -- Customer info
         u.first_name                 AS first_name,
         u.last_name                  AS last_name,
         u.email                      AS email,
         u.phone                      AS phone
       FROM orders o
       LEFT JOIN shipping     s   ON s.order_id  = o.order_id
       LEFT JOIN payments     pay ON pay.order_id = o.order_id
       LEFT JOIN users        u   ON u.user_id   = o.user_id
       WHERE o.order_id = ? AND o.user_id = ?
       LIMIT 1`,
      [orderId, userId]
    );

    if (orderRows.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const order = orderRows[0];

    // Fetch order items
    const [itemRows] = await db.query(
      `SELECT 
         oi.order_item_id,
         oi.product_id,
         p.name                    AS product_name,
         p.product_code            AS product_code,
         oi.price,
         oi.quantity,
         oi.variant_data           AS variant
       FROM order_items oi
       JOIN products p ON p.product_id = oi.product_id
       WHERE oi.order_id = ?`,
      [orderId]
    );

    // Structure the response to match front-end expectations
    const responseData = {
      order_id: order.order_id,
      order_code: order.order_code,
      order_status: order.order_status,
      payment_status: order.payment_status,
      total_price: order.total_price,
      created_at: order.created_at,
      updated_at: order.updated_at,
      tracking_number: order.tracking_number,
      shipping_address: order.shipping_address,
      // Nested helpers
      shipping: {
        name: order.first_name + ' ' + order.last_name,
        phone: order.phone,
        email: order.email,
        address: order.shipping_address
      },
      payment: {
        payment_method: order.payment_method,
        transaction_id: order.transaction_id
      },
      items: itemRows
    };

    return res.json(responseData);
  } catch (error) {
    console.error('Error fetching order by ID:', error);
    res.status(500).json({ message: 'Failed to fetch order', error: error.message });
  }
}

async function updateOrder(req, res) {
  // ...migrated as-is from the route file
}

async function deleteOrder(req, res) {
  // ...migrated as-is from the route file
}

async function checkProductPurchase(req, res) {
  // ...migrated as-is from the route file
}

// Auto-complete orders that meet certain criteria
async function autoCompleteOrders(req, res) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Get orders that are in 'delivered' status for more than 3 days
    const [orders] = await connection.query(`
      SELECT o.* 
      FROM orders o
      LEFT JOIN shipping s ON o.order_id = s.order_id
      WHERE o.order_status = 'delivered'
      AND o.updated_at <= DATE_SUB(NOW(), INTERVAL 3 DAY)
      AND o.payment_status = 'paid'
      AND NOT EXISTS (
        SELECT 1 
        FROM order_issues oi 
        WHERE oi.order_id = o.order_id 
        AND oi.status = 'open'
      )
    `);

    if (orders.length === 0) {
      await connection.commit();
      return res.json({ 
        message: 'No orders to auto-complete',
        completed: 0
      });
    }

    // Update orders to completed status
    const orderIds = orders.map(order => order.order_id);
    await connection.query(`
      UPDATE orders 
      SET 
        order_status = 'completed',
        updated_at = NOW(),
        completion_date = NOW()
      WHERE order_id IN (?)
    `, [orderIds]);

    // Log the auto-completion
    const completionLogs = orderIds.map(orderId => [
      orderId,
      'Order auto-completed by system',
      new Date(),
      'system'
    ]);

    await connection.query(`
      INSERT INTO order_logs 
      (order_id, message, created_at, created_by)
      VALUES ?
    `, [completionLogs]);

    await connection.commit();

    res.json({
      message: 'Orders auto-completed successfully',
      completed: orders.length,
      orders: orders.map(o => ({
        order_id: o.order_id,
        order_code: o.order_code
      }))
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error in auto-completing orders:', error);
    res.status(500).json({ 
      message: 'Failed to auto-complete orders',
      error: error.message
    });
  } finally {
    connection.release();
  }
}

async function markOrderReceived(req, res) {
  const connection = await db.getConnection();
  try {
    const userId  = req.user?.id;
    const orderId = req.params.id;

    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Verify order belongs to user and current status is delivered or shipped
    const [[order]] = await connection.query(
      'SELECT order_status, user_id FROM orders WHERE order_id = ?',
      [orderId]
    );

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.user_id !== userId) {
      return res.status(403).json({ message: 'You do not have permission to update this order' });
    }

    const allowedStatuses = ['delivered', 'received'];
    if (!allowedStatuses.includes(order.order_status)) {
      return res.status(400).json({ message: `Order status '${order.order_status}' cannot be marked as received` });
    }

    await connection.query(
      'UPDATE orders SET order_status = ?, updated_at = NOW() WHERE order_id = ?',
      ['completed', orderId]
    );

    res.json({ message: 'Order marked as received', order_id: orderId, new_status: 'completed' });
  } catch (error) {
    console.error('Error marking order received:', error);
    res.status(500).json({ message: 'Failed to update order', error: error.message });
  } finally {
    connection.release();
  }
}

module.exports = {
  createOrder,
  getOrders,
  getOrderById,
  updateOrder,
  deleteOrder,
  checkProductPurchase,
  autoCompleteOrders,
  markOrderReceived
};
