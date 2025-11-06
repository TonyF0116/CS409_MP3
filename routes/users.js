module.exports = function (router) {
  const usersRoute = router.route("/users");
  const userIdRoute = router.route("/users/:id");
  const userModel = require("../models/user");
  const taskModel = require("../models/task");
  const mongoose = require("mongoose");

  function parseParams(params) {
    const result = {};
    for (const key in params) {
      result[key] = JSON.parse(params[key]);
    }
    return result;
  }

  usersRoute.get(async function (req, res) {
    let params = null;
    try {
      params = parseParams(req.query);
    } catch (err) {
      return res.status(400).json({
        message: "Query parameters parse failed",
        data: err.message,
      });
    }

    try {
      let query = userModel.find({});
      if (params.where) {
        query = userModel.find(params.where);
      }
      if (params.sort) {
        query.sort(params.sort);
      }
      if (params.select) {
        query.select(params.select);
      }
      if ("skip" in params) {
        query.skip(params.skip);
      }
      if ("limit" in params) {
        query.limit(params.limit);
      }
      const result = await query.exec();

      if (params.count) {
        return res.status(200).json({ message: "OK", data: result.length });
      }

      return res.status(200).json({ message: "OK", data: result });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "MongoDB error", data: err.message });
    }
  });

  usersRoute.post(async function (req, res) {
    const newUser = new userModel(req.body);
    const validationError = newUser.validateSync();
    if (validationError) {
      return res.status(400).json({
        message: "Missing required fields",
        data: validationError.message,
      });
    }

    try {
      const exist = await userModel.findOne({ email: req.body.email });
      if (exist) {
        return res
          .status(400)
          .json({ message: "Email already exists", data: null });
      }

      const result = await newUser.save();
      return res.status(201).json({ message: "User created", data: result });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "MongoDB error", data: err.message });
    }
  });

  userIdRoute.get(async function (req, res) {
    let params = null;
    try {
      params = parseParams(req.query);
    } catch (err) {
      return res.status(400).json({
        message: "Query parameters parse failed",
        data: err.message,
      });
    }

    try {
      let user = await userModel.findById(req.params.id);
      if (!user) {
        return res.status(404).json({ message: "User not found", data: null });
      }

      let query = userModel.find({ _id: req.params.id });
      if (params.select) {
        query = query.select(params.select);
      }
      const result = await query.exec();
      return res.status(200).json({ message: "OK", data: result });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "MongoDB error", data: err.message });
    }
  });

  userIdRoute.put(async function (req, res) {
    if (!req.body.name || !req.body.email) {
      return res
        .status(400)
        .json({ message: "Missing required fields", data: null });
    }

    try {
      const session = await mongoose.startSession();
      let result = null;
      try {
        await session.withTransaction(async () => {
          const user = await userModel.findById(req.params.id).session(session);
          if (!user) {
            throw new Error("User not found");
          }

          user.name = req.body.name;
          user.email = req.body.email;

          if ("pendingTasks" in req.body) {
            for (const taskId of user.pendingTasks) {
              const task = await taskModel.findById(taskId).session(session);
              if (!task) {
                throw new Error(`Task with ID ${taskId} not found`);
              }

              if (task.completed) {
                throw new Error("Task to assign is already completed");
              }

              task.assignedUser = "";
              task.assignedUserName = "unassigned";
              await task.save({ session });
            }

            user.pendingTasks = req.body.pendingTasks;

            for (const taskId of user.pendingTasks) {
              const task = await taskModel.findById(taskId).session(session);
              if (!task) {
                throw new Error(`Task with ID ${taskId} not found`);
              }

              task.assignedUser = user._id;
              task.assignedUserName = user.name;
              await task.save({ session });
            }
          }

          result = await user.save({ session });
        });

        return res.status(200).json({ message: "OK", data: result });
      } catch (err) {
        return res
          .status(500)
          .json({ message: "Transaction failed", data: err.message });
      } finally {
        await session.endSession();
      }
    } catch (err) {
      return res
        .status(500)
        .json({ message: "MongoDB error", data: err.message });
    }
  });

  userIdRoute.delete(async function (req, res) {
    try {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const user = await userModel.findById(req.params.id).session(session);
          if (!user) {
            throw new Error("User not found");
          }

          for (const taskId of user.pendingTasks) {
            const task = await taskModel.findById(taskId).session(session);
            if (!task) {
              throw new Error(`Task with ID ${taskId} not found`);
            }
            if (!task.completed) {
              task.assignedUser = "";
              task.assignedUserName = "unassigned";
              await task.save({ session });
            }
          }
          await user.remove({ session });
        });

        return res.status(204).send();
      } catch (err) {
        return res
          .status(500)
          .json({ message: "Transaction failed", data: err.message });
      } finally {
        await session.endSession();
      }
    } catch (err) {
      return res
        .status(500)
        .json({ message: "MongoDB error", data: err.message });
    }
  });

  return router;
};
