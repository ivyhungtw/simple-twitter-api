const bcrypt = require('bcryptjs')
const db = require('../models')
const User = db.User
const Tweet = db.Tweet
const Reply = db.Reply
const Like = db.Like

const helpers = require('../_helpers')
const { sequelize } = require('../models')

// Upload image
const imgur = require('imgur-node-api')
const IMGUR_CLIENT_ID = process.env.IMGUR_CLIENT_ID

const uploadImg = path => {
  return new Promise((resolve, reject) => {
    imgur.upload(path, (err, img) => {
      if (err) {
        return reject(err)
      }
      resolve(img)
    })
  })
}

// JWT
const jwt = require('jsonwebtoken')
const passportJWT = require('passport-jwt')
const ExtractJwt = passportJWT.ExtractJwt
const JwtStrategy = passportJWT.Strategy

const userController = {
  login: async (req, res) => {
    // Make sure all the fields are filled out
    if (!req.body.account || !req.body.password) {
      return res.json({
        status: 'error',
        message: 'All fields are required.'
      })
    }

    // Check email and password
    const account = req.body.account
    const password = req.body.password

    const user = await User.findOne({ where: { account } })

    if (!user) {
      return res
        .status(401)
        .json({ status: 'error', message: 'That account does not exist.' })
    }

    if (!bcrypt.compareSync(password, user.password)) {
      return res
        .status(401)
        .json({ status: 'error', message: 'Incorrect Password' })
    }

    // Sign token
    const payload = { id: user.id }
    const token = jwt.sign(payload, process.env.JWT_SECRET)
    return res.json({
      status: 'success',
      message: 'login successfully',
      token: token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        account: user.account,
        avatar: user.avatar,
        introduction: user.introduction,
        cover: user.cover,
        role: user.role
      }
    })
  },
  register: async (req, res) => {
    const { account, name, email, password, checkPassword } = req.body
    const emailRule = /^\w+((-\w+)|(\.\w+)|(\+\w+))*@[A-Za-z0-9]+((\.|-)[A-Za-z0-9]+)*\.[A-Za-z]+$/
    const errors = []

    // Before creating an account,
    // make sure all the required fields are correct
    if (!account || !name || !email || !password || !checkPassword) {
      errors.push({ message: 'Please fill out all fields.' })
    }
    if (email.search(emailRule) === -1) {
      errors.push({ message: 'Please enter the correct email address.' })
    }
    if (password.length < 4 || password.length > 12) {
      errors.push({ message: 'Password does not meet the required length' })
    }
    if (password !== checkPassword) {
      errors.push({ message: 'Password and checkPassword do not match.' })
    }
    if (errors.length > 0) {
      return res.json({ status: 'error', errors, userInput: req.body })
    }

    try {
      // make sure email amd account has not been used yet
      let user = await User.findOne({ where: { email } })

      if (user) {
        return res.json({
          status: 'error',
          message: `A user with ${email} already exists. Choose a different address or login directly.`,
          userInput: req.body
        })
      }

      user = await User.findOne({ where: { account } })

      if (user) {
        return res.json({
          status: 'error',
          message: `A user with account '${account}' already exists. Choose a different account or login directly.`,
          userInput: req.body
        })
      }

      await User.create({
        account,
        name,
        email,
        password: bcrypt.hashSync(
          req.body.password,
          bcrypt.genSaltSync(10),
          null
        ),
        role: 'user',
        avatar: 'https://i.imgur.com/q6bwDGO.png',
        cover: 'https://i.imgur.com/1jDf2Me.png'
      })

      return res.status(200).json({
        status: 'success',
        message: `${req.body.account} register successfully! Please login.`
      })
    } catch (error) {
      console.log(error)
    }
  },
  getTopUsers: async (req, res) => {
    let users = await User.findAll({
      where: { role: 'user' },
      include: { model: User, as: 'Followers' },
      attributes: [
        'id',
        'name',
        'avatar',
        'account',
        [
          sequelize.literal(
            '(SELECT COUNT(*) FROM Followships WHERE Followships.followingId = User.id)'
          ),
          'followersCount'
        ]
      ],
      order: [[sequelize.literal('followersCount'), 'DESC']],
      limit: 6
    })

    // Clean up users data
    const followings = helpers
      .getUser(req)
      .Followings.map(following => following.id)

    users = users.map(user => ({
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      account: user.account,
      isFollowed: followings.includes(user.id)
    }))

    return res.status(200).json(users)
  },
  getUser: async (req, res) => {
    let user = await User.findByPk(req.params.id, {
      attributes: [
        'id',
        'name',
        'account',
        'email',
        'role',
        'avatar',
        'cover',
        'introduction'
      ],
      include: [
        Tweet,
        { model: User, as: 'Followers' },
        { model: User, as: 'Followings' },
        { model: User, as: 'Subscribers' }
      ]
    })

    // Clean up user data

    // To pass the test
    let subscriptions = helpers.getUser(req).Subscriptions
    subscriptions = subscriptions
      ? subscriptions.map(subscription => subscription.id)
      : subscriptions

    const followings = helpers
      .getUser(req)
      .Followings.map(following => following.id)

    user = {
      id: user.id,
      name: user.name,
      email: user.email,
      account: user.account,
      avatar: user.avatar,
      introduction: user.introduction,
      cover: user.cover,
      role: user.role,
      tweetCount: user.Tweets.length,
      followerCount: user.Followers.length,
      followingCount: user.Followings.length,
      isFollowed: followings.includes(user.id),
      isSubscribed: subscriptions
        ? subscriptions.includes(user.id)
        : subscriptions
    }

    res.status(200).json(user)
  },
  editUser: async (req, res) => {
    const {
      account,
      name,
      email,
      password,
      checkPassword,
      introduction,
      page
    } = req.body
    const emailRule = /^\w+((-\w+)|(\.\w+)|(\+\w+))*@[A-Za-z0-9]+((\.|-)[A-Za-z0-9]+)*\.[A-Za-z]+$/
    const errors = []
    const userId = helpers.getUser(req).id
    const id = req.params.id
    const { files } = req
    let newAvatar
    let newCover
    const acceptedType = ['.png', '.jpg', '.jpeg']

    // Users can only edit their own profile
    if (userId !== Number(id)) {
      return res
        .status(401)
        .json({ status: 'error', message: "You can not edit other's profile" })
    }

    let user = await User.findByPk(userId)

    try {
      // setting

      if (page === 'setting') {
        // Make sure all fields are filled out
        if (!account || !name || !email || !password || !checkPassword) {
          return res.json({
            status: 'error',
            message: 'Please fill out all fields.'
          })
        }
        // Make sure all fields are correct
        if (password !== checkPassword) {
          errors.push({ message: 'Password and checkPassword do not match.' })
        }
        if (email.search(emailRule) === -1) {
          errors.push({ message: 'Please enter the correct email address.' })
        }
        if (name.length > 50) {
          errors.push({ message: 'Name can not be longer than 50 characters.' })
        }
        if (account.length > 50) {
          errors.push({
            message: 'Account can not be longer than 50 characters.'
          })
        }
        if (errors.length > 0) {
          return res.json({ status: 'error', errors })
        }
        // make sure email amd account has not been used by others yet
        const check = { email, account }
        for (const key in check) {
          const value = check[key]
          user = await User.findOne({ where: { [key]: value } })

          if (user && value !== helpers.getUser(req)[key]) {
            return res.json({
              status: 'error',
              message: `A user with ${value} already exists. Choose a different ${key}.`
            })
          }
        }

        user = await User.findByPk(userId)
        await user.update({
          account,
          name,
          email,
          password: bcrypt.hashSync(
            req.body.password,
            bcrypt.genSaltSync(10),
            null
          )
        })

        return res.status(200).json({
          status: 'success',
          message: `${page} update successfully`
        })
      }

      // profile
      if (!name || name.length > 50) {
        errors.push({
          message: 'Name can not be empty or longer than 50 characters'
        })
      }
      // Introduction can be empty
      if (introduction) {
        if (introduction.length > 160) {
          errors.push({
            message: 'Introduction can not be longer than 160 characters'
          })
        }
      }
      // Check image's type
      if (files) {
        for (const file in files) {
          const imgData = files[file][0]
          const fileType = imgData.originalname
            .substring(imgData.originalname.lastIndexOf('.'))
            .toLowerCase()

          if (acceptedType.indexOf(fileType) === -1) {
            errors.push({
              message: `${imgData.fieldname}'s image type is not accepted. Please upload the image ends with png, jpg, or jpeg.`
            })
          }
        }
      }

      if (errors.length > 0) {
        return res.json({ status: 'error', errors })
      }

      // Images saved in /temp will be removed,
      // so we need to upload them to imgur
      const images = {}
      if (files) {
        imgur.setClientID(IMGUR_CLIENT_ID)
        for (const key in files) {
          images[key] = await uploadImg(files[key][0].path)
        }
      }

      await user.update({
        name,
        introduction,
        avatar: images.avatar ? images.avatar.data.link : user.avatar,
        cover: images.cover ? images.cover.data.link : user.cover
      })

      return res.status(200).json({
        status: 'success',
        message: 'profile update successfully'
      })
    } catch (error) {
      console.log(error)
    }
  },
  getTweets: async (req, res) => {
    try {
      // Make sure user exists
      const user = await User.findByPk(req.params.id)
      if (!user) {
        return res.status(401).json({
          status: 'error',
          message: 'user does not exist'
        })
      }

      let tweets = await Tweet.findAll({
        where: { UserId: req.params.id },
        order: [['createdAt', 'DESC']],
        include: [Reply, Like]
      })

      // Clean up data
      tweets = tweets.map(tweet => ({
        id: tweet.id,
        description: tweet.description,
        createdAt: tweet.createdAt,
        replyCount: tweet.Replies.length,
        likeCount: tweet.Likes.length
      }))

      return res.status(200).json(tweets)
    } catch (error) {
      console.log(error)
    }
  },
  getRepliesAndTweets: async (req, res) => {
    //
    try {
      // Make sure user exists
      const user = await User.findByPk(req.params.id)
      if (!user) {
        return res.status(401).json({
          status: 'error',
          message: 'user does not exist'
        })
      }

      let replies = await Reply.findAll({
        where: { UserId: req.params.id },
        order: [['createdAt', 'DESC']],
        include: [{ model: Tweet, include: [Like, Reply, User] }]
      })

      // Clean up data
      replies = replies.map(reply => {
        // If the tweet has been deleted,
        // we will not show the reply
        const tweet = reply.Tweet
        if (!tweet) {
          return {}
        }

        return {
          id: reply.id,
          comment: reply.comment,
          createdAt: reply.createdAt,
          Tweet: {
            id: tweet.id,
            description: tweet.description,
            createdAt: tweet.createdAt,
            User: {
              id: tweet.User.id,
              name: tweet.User.name,
              account: tweet.User.account,
              avatar: tweet.User.avatar
            },
            replyCount: tweet.Replies.length,
            likeCount: tweet.Likes.length
          }
        }
      })

      return res.status(200).json(replies)
    } catch (error) {
      console.log(error)
    }
  },
  getLikes: async (req, res) => {
    try {
      // Make sure user exists
      const user = await User.findByPk(req.params.id)
      if (!user) {
        return res.status(401).json({
          status: 'error',
          message: 'user does not exist'
        })
      }

      let likes = await Like.findAll({
        where: { UserId: req.params.id },
        order: [['createdAt', 'DESC']],
        include: [{ model: Tweet, include: [Like, Reply, User] }]
      })

      let currentUserLikes = helpers.getUser(req).LikedTweets

      if (currentUserLikes) {
        currentUserLikes = currentUserLikes.map(likeTweet => likeTweet.id)
      }

      // Clean up data
      likes = likes.map(like => {
        // If the tweet has been deleted,
        // we will not show the tweet
        const tweet = like.Tweet
        if (!tweet) {
          return {}
        }

        return {
          id: like.id,
          comment: like.comment,
          createdAt: like.createdAt,
          isLiked: currentUserLikes
            ? currentUserLikes.includes(like.TweetId)
            : false,
          TweetId: like.TweetId,
          Tweet: {
            description: tweet.description,
            createdAt: tweet.createdAt,
            User: {
              id: tweet.User.id,
              name: tweet.User.name,
              account: tweet.User.account,
              avatar: tweet.User.avatar
            },
            replyCount: tweet.Replies.length,
            likeCount: tweet.Likes.length
          }
        }
      })

      return res.status(200).json(likes)
    } catch (error) {
      console.log(error)
    }
  },
  getFollowers: async (req, res) => {
    try {
      const id = req.params.id
      const currentUser = helpers.getUser(req)
      // Make sure user exists
      const user = await User.findByPk(id)
      if (!user) {
        return res.status(401).json({
          status: 'error',
          message: 'user does not exist'
        })
      }

      let followers = (
        await User.findByPk(id, {
          include: [{ model: User, as: 'Followers' }]
        })
      ).Followers

      let currentUserFollowings = helpers.getUser(req).Followings
      if (currentUserFollowings) {
        currentUserFollowings = currentUserFollowings.map(
          following => following.id
        )
      }

      // Clean up data
      followers = followers.map(follower => {
        return {
          followerId: follower.id,
          name: follower.name,
          account: follower.account,
          avatar: follower.avatar,
          introduction: follower.introduction,
          createdAt: follower.createdAt,
          isFollowing:
            currentUserFollowings && follower.id !== currentUser.id
              ? currentUserFollowings.includes(follower.id)
              : null
        }
      })

      return res.status(200).json(followers)
    } catch (error) {
      console.log(error)
    }
  },
  getFollowings: async (req, res) => {
    try {
      const id = req.params.id
      const currentUser = helpers.getUser(req)
      // Make sure user exists
      const user = await User.findByPk(id)
      if (!user) {
        return res.status(401).json({
          status: 'error',
          message: 'user does not exist'
        })
      }

      let followings = (
        await User.findByPk(id, {
          include: [{ model: User, as: 'Followings' }]
        })
      ).Followings

      let currentUserFollowings = helpers.getUser(req).Followings
      if (currentUserFollowings) {
        currentUserFollowings = currentUserFollowings.map(
          following => following.id
        )
      }

      // Clean up data
      followings = followings.map(following => {
        return {
          followingId: following.id,
          name: following.name,
          account: following.account,
          avatar: following.avatar,
          introduction: following.introduction,
          createdAt: following.createdAt,
          isFollowing:
            currentUserFollowings && following.id !== currentUser.id
              ? currentUserFollowings.includes(following.id)
              : null
        }
      })

      return res.status(200).json(followings)
    } catch (error) {
      console.log(error)
    }
  },
  getCurrentUser: async (req, res) => {
    return res.status(200).json({
      id: req.user.id,
      name: req.user.name,
      account: req.user.account,
      email: req.user.email,
      avatar: req.user.avatar,
      role: req.user.role,
      cover: req.user.cover,
      introduction: req.user.introduction
    })
  }
}

module.exports = userController
