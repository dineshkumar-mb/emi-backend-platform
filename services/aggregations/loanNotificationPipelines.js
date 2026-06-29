/**
 * MongoDB aggregation pipelines for scheduler sweeps.
 * All date math is executed server-side — no full collection scans.
 */

/**
 * Returns loans whose next EMI due date is exactly tomorrow.
 * Uses $dateDiff to avoid timezone-fragile JS date math.
 */
export function buildDueTomorrowPipeline() {
  return [
    {
      $match: { status: 'active' }
    },
    {
      $addFields: {
        daysUntilDue: {
          $dateDiff: {
            startDate: '$$NOW',
            endDate: '$nextDueDate',
            unit: 'day'
          }
        }
      }
    },
    {
      $match: { daysUntilDue: 1 }
    },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
        pipeline: [
          { $project: { name: 1, phone: 1, whatsappNumber: 1, geo: 1, notificationSettings: 1, currentBalance: 1 } }
        ]
      }
    },
    { $unwind: '$user' },
    {
      $match: { 
        'user.whatsappNumber': { $exists: true, $ne: '' },
        'user.notificationSettings.emiReminders': { $ne: false }
      }
    },
    {
      $project: {
        loanId: '$_id',
        userId: '$user._id',
        userName: '$user.name',
        phone: '$user.whatsappNumber',
        region: '$user.geo',
        emiAmount: 1,
        nextDueDate: 1,
        outstandingBalance: 1,
        notificationType: {
          $cond: {
            if: { $lt: ['$user.currentBalance', '$emiAmount'] },
            then: 'LOW_BALANCE_ALERT',
            else: 'DUE_TOMORROW'
          }
        }
      }
    }
  ];
}

/**
 * Returns loans due today.
 */
export function buildDueTodayPipeline() {
  return [
    { $match: { status: 'active' } },
    {
      $addFields: {
        daysUntilDue: {
          $dateDiff: {
            startDate: '$$NOW',
            endDate: '$nextDueDate',
            unit: 'day'
          }
        }
      }
    },
    { $match: { daysUntilDue: 0 } },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
        pipeline: [
          { $project: { name: 1, phone: 1, whatsappNumber: 1, geo: 1, notificationSettings: 1, currentBalance: 1 } }
        ]
      }
    },
    { $unwind: '$user' },
    {
      $match: { 
        'user.whatsappNumber': { $exists: true, $ne: '' },
        'user.notificationSettings.emiReminders': { $ne: false }
      }
    },
    {
      $project: {
        loanId: '$_id',
        userId: '$user._id',
        userName: '$user.name',
        phone: '$user.whatsappNumber',
        region: '$user.geo',
        emiAmount: 1,
        nextDueDate: 1,
        outstandingBalance: 1,
        notificationType: {
          $cond: {
            if: { $lt: ['$user.currentBalance', '$emiAmount'] },
            then: 'LOW_BALANCE_ALERT',
            else: 'DUE_TODAY'
          }
        }
      }
    }
  ];
}

/**
 * Returns loans whose next EMI due date is exactly 3 days away.
 */
export function buildDueIn3DaysPipeline() {
  return [
    { $match: { status: 'active' } },
    {
      $addFields: {
        daysUntilDue: {
          $dateDiff: {
            startDate: '$$NOW',
            endDate: '$nextDueDate',
            unit: 'day'
          }
        }
      }
    },
    { $match: { daysUntilDue: 3 } },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
        pipeline: [
          { $project: { name: 1, phone: 1, whatsappNumber: 1, geo: 1, notificationSettings: 1, currentBalance: 1 } }
        ]
      }
    },
    { $unwind: '$user' },
    {
      $match: { 
        'user.whatsappNumber': { $exists: true, $ne: '' },
        'user.notificationSettings.emiReminders': { $ne: false }
      }
    },
    {
      $project: {
        loanId: '$_id',
        userId: '$user._id',
        userName: '$user.name',
        phone: '$user.whatsappNumber',
        region: '$user.geo',
        emiAmount: 1,
        nextDueDate: 1,
        outstandingBalance: 1,
        notificationType: {
          $cond: {
            if: { $lt: ['$user.currentBalance', '$emiAmount'] },
            then: 'LOW_BALANCE_ALERT',
            else: 'DUE_IN_3_DAYS'
          }
        }
      }
    }
  ];
}

/**
 * Returns loans that are overdue (past due date, unpaid).
 * Checks daysUntilDue < 0 AND no payment recorded after the due date.
 */
export function buildOverduePipeline() {
  return [
    { $match: { status: 'active' } },
    {
      $addFields: {
        daysOverdue: {
          $dateDiff: {
            startDate: '$nextDueDate',
            endDate: '$$NOW',
            unit: 'day'
          }
        }
      }
    },
    // Only loans that are 1–60 days overdue (avoids notifying very old debt endlessly)
    { $match: { daysOverdue: { $gte: 1, $lte: 60 } } },
    // Exclude loans already paid this cycle
    {
      $lookup: {
        from: 'loanpayments',
        let: { loanId: '$_id', dueDate: '$nextDueDate' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$loanId', '$$loanId'] },
                  { $gte: ['$paymentDate', '$$dueDate'] },
                  { $eq: ['$paymentStatus', 'success'] }
                ]
              }
            }
          }
        ],
        as: 'recentPayments'
      }
    },
    { $match: { recentPayments: { $size: 0 } } },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
        pipeline: [
          { $project: { name: 1, phone: 1, whatsappNumber: 1, geo: 1, notificationSettings: 1 } }
        ]
      }
    },
    { $unwind: '$user' },
    {
      $match: { 
        'user.whatsappNumber': { $exists: true, $ne: '' },
        'user.notificationSettings.overdueAlerts': { $ne: false }
      }
    },
    {
      $project: {
        loanId: '$_id',
        userId: '$user._id',
        userName: '$user.name',
        phone: '$user.whatsappNumber',
        region: '$user.geo',
        emiAmount: 1,
        nextDueDate: 1,
        outstandingBalance: 1,
        daysOverdue: 1,
        notificationType: { $literal: 'OVERDUE' }
      }
    }
  ];
}
