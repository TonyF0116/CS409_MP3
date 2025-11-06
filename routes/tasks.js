module.exports = function (router) {
  const tasksRoute = router.route("/tasks");
  const taskIdRoute = router.route("/tasks/:id");
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

  tasksRoute.get(async function (req, res) {
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
      let query = taskModel.find({});
      if (params.where) {
        query = taskModel.find(params.where);
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

  tasksRoute.post(async function (req, res) {
    const newTask = new taskModel(req.body);
    const validationError = newTask.validateSync();
    if (validationError) {
      return res.status(400).json({
        message: "Missing required fields",
        data: validationError.message,
      });
    }

    try {
      const result = await newTask.save();
      return res.status(201).json({ message: "Task created", data: result });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "MongoDB error", data: err.message });
    }
  });

  taskIdRoute.get(async function (req, res) {
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
      let task = await taskModel.findById(req.params.id);
      if (!task) {
        return res.status(404).json({ message: "Task not found", data: null });
      }

      let query = taskModel.find({ _id: req.params.id });
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

  taskIdRoute.put(async function (req, res) {
    if (!req.body.name || !req.body.deadline) {
      return res
        .status(400)
        .json({ message: "Missing required fields", data: null });
    }
    try {
      const session = await mongoose.startSession();
      let result = null;
      try {
        await session.withTransaction(async () => {
          let task = await taskModel.findById(req.params.id);
          if (!task) {
            throw new Error("Task not found");
          }

          if (task.completed) {
            throw new Error("Task is already completed");
          }

          task.name = req.body.name;
          task.deadline = req.body.deadline;
          if ("description" in req.body) {
            task.description = req.body.description;
          }

          if ("completed" in req.body) {
            task.completed = req.body.completed;
            if (task.assignedUser != "") {
              const user = await userModel
                .findById(task.assignedUser)
                .session(session);
              if (!user) {
                throw new Error("User not found");
              }

              user.pendingTasks = user.pendingTasks.filter(
                (taskId) => taskId.toString() !== task._id.toString()
              );

              if (!req.body.completed) {
                user.pendingTasks.push(task._id);
              }
              await user.save({ session });
            }
          }

          if ("assignedUser" in req.body) {
            if (task.assignedUser != "") {
              const oldUser = await userModel
                .findById(task.assignedUser)
                .session(session);
              if (!oldUser) {
                throw new Error("Old user not found");
              }
              oldUser.pendingTasks = oldUser.pendingTasks.filter(
                (taskId) => taskId.toString() !== task._id.toString()
              );
              await oldUser.save({ session });
            }
            task.assignedUser = req.body.assignedUser;

            if (task.assignedUser != "" && !task.completed) {
              const user = await userModel
                .findById(task.assignedUser)
                .session(session);
              if (!user) {
                throw new Error("User not found");
              }
              user.pendingTasks.push(task._id);
              await user.save({ session });
            }
          }
          if ("assignedUserName" in req.body) {
            task.assignedUserName = req.body.assignedUserName;
          }

          result = await task.save({ session });
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

  taskIdRoute.delete(async function (req, res) {
    try {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const task = await taskModel.findById(req.params.id).session(session);
          if (!task) {
            throw new Error("Task not found");
          }

          if (!task.completed) {
            const user = await userModel
              .findById(task.assignedUser)
              .session(session);
            if (!user) {
              throw new Error("User not found");
            }
            user.pendingTasks = user.pendingTasks.filter(
              (taskId) => taskId.toString() !== task._id.toString()
            );
            await user.save({ session });
          }

          await task.remove({ session });
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
