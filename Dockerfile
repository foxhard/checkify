FROM jekyll/jekyll:4.2.2
WORKDIR /srv/jekyll
COPY Gemfile Gemfile.lock* ./
RUN bundle install
EXPOSE 4000 35729
CMD ["jekyll", "serve", "--host", "0.0.0.0", "--livereload", "--force_polling"]
